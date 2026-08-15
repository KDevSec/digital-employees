import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, Form, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import false, or_, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.audit import record_audit
from app.database import get_session
from app.domain.authorization import ROLE_PERMISSIONS, ScopeType
from app.domain.crypto import InvalidProof, jwk_thumbprint, verify_es256_jwt
from app.errors import ApiError
from app.models import (
    EnrollmentChallenge,
    EnrollmentRequest,
    MachineCredential,
    UsedJti,
    WorkbenchInstance,
    utc_now,
)


router = APIRouter()


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class EnrollmentCreate(BaseModel):
    installation_id: UUID
    public_key: dict[str, str]
    display_name: str = Field(min_length=1, max_length=200)
    workbench_version: str = Field(min_length=1, max_length=50)
    os: str = Field(min_length=1, max_length=30)
    arch: str = Field(min_length=1, max_length=30)


class RejectBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ProofBody(BaseModel):
    proof_jwt: str = Field(min_length=20, max_length=8192)


class HeartbeatBody(BaseModel):
    event_id: str = Field(min_length=1, max_length=100)
    reported_at: datetime
    workbench_version: str = Field(min_length=1, max_length=50)


class RevokeBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def enrollment_json(item: EnrollmentRequest) -> dict:
    return {
        "id": item.id,
        "owner_principal_id": item.owner_principal_id,
        "domain_id": item.domain_id_snapshot,
        "department_id": item.department_id_snapshot,
        "installation_id": item.installation_id,
        "display_name": item.display_name,
        "workbench_version": item.version,
        "os": item.os,
        "arch": item.arch,
        "status": item.status,
        "reviewer_id": item.reviewer_id,
        "review_reason": item.review_reason,
        "created_at": item.created_at,
        "expires_at": item.expires_at,
    }


def workbench_json(item: WorkbenchInstance, offline_seconds: int) -> dict:
    now = utc_now()
    online = (
        item.status == "ACTIVE"
        and item.last_heartbeat_at is not None
        and now - aware(item.last_heartbeat_at) <= timedelta(seconds=offline_seconds)
    )
    return {
        "id": item.id,
        "owner_principal_id": item.owner_principal_id,
        "domain_id": item.domain_id,
        "department_id": item.department_id,
        "team_id": item.team_id,
        "installation_id": item.installation_id,
        "display_name": item.display_name,
        "status": item.status,
        "credential_status": "REVOKED" if item.status == "REVOKED" else "ACTIVE",
        "connection_status": "REVOKED" if item.status == "REVOKED" else ("ONLINE" if online else "OFFLINE"),
        "reported_version": item.reported_version,
        "reported_os": item.reported_os,
        "reported_arch": item.reported_arch,
        "first_heartbeat_at": item.first_heartbeat_at,
        "last_heartbeat_at": item.last_heartbeat_at,
        "created_at": item.created_at,
    }


def may_access_enrollment(identity: AuthenticatedPrincipal, item: EnrollmentRequest) -> bool:
    if item.owner_principal_id == identity.principal.id:
        return True
    return any("workbench.enrollment.review" in ROLE_PERMISSIONS[a.role] for a in identity.authorization.assignments)


@router.post("/api/v1/workbench-enrollments", status_code=status.HTTP_201_CREATED)
async def create_enrollment(
    body: EnrollmentCreate,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "workbench.enroll")
    try:
        thumbprint = jwk_thumbprint(body.public_key)
        if body.public_key.get("kty") != "EC" or body.public_key.get("crv") != "P-256" or "d" in body.public_key:
            raise InvalidProof("public P-256 key required")
    except InvalidProof as exc:
        raise ApiError(422, "PUBLIC_KEY_INVALID", "A public P-256 JWK is required") from exc
    installation_id = str(body.installation_id)
    existing = session.scalar(
        select(EnrollmentRequest).where(
            EnrollmentRequest.owner_principal_id == identity.principal.id,
            EnrollmentRequest.installation_id == installation_id,
            EnrollmentRequest.public_key_thumbprint == thumbprint,
        )
    )
    if existing:
        return enrollment_json(existing)
    item = EnrollmentRequest(
        id=str(uuid4()),
        owner_principal_id=identity.principal.id,
        domain_id_snapshot=identity.principal.domain_id,
        department_id_snapshot=identity.principal.department_id,
        team_id_snapshot=identity.principal.team_id,
        installation_id=installation_id,
        public_jwk=body.public_key,
        public_key_thumbprint=thumbprint,
        display_name=body.display_name,
        version=body.workbench_version,
        os=body.os.lower(),
        arch=body.arch.lower(),
        status="PENDING_REVIEW",
        expires_at=utc_now() + timedelta(hours=request.app.state.settings.enrollment_ttl_hours),
    )
    session.add(item)
    record_audit(
        session,
        request,
        event_type="ENROLLMENT_REQUESTED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="ENROLLMENT_REQUEST",
        target_id=item.id,
        domain_id=item.domain_id_snapshot,
        department_id=item.department_id_snapshot,
        summary="Submitted own workbench enrollment request",
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.scalar(
            select(EnrollmentRequest).where(
                EnrollmentRequest.owner_principal_id == identity.principal.id,
                EnrollmentRequest.installation_id == installation_id,
                EnrollmentRequest.public_key_thumbprint == thumbprint,
            )
        )
        if existing is None:
            raise
        return enrollment_json(existing)
    return enrollment_json(item)


@router.get("/api/v1/workbench-enrollments")
async def list_enrollments(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    can_review = any("workbench.enrollment.review" in ROLE_PERMISSIONS[a.role] for a in identity.authorization.assignments)
    statement = select(EnrollmentRequest)
    if not can_review:
        statement = statement.where(EnrollmentRequest.owner_principal_id == identity.principal.id)
    return [enrollment_json(row) for row in session.scalars(statement.order_by(EnrollmentRequest.created_at.desc())).all()]


@router.get("/api/v1/workbench-enrollments/{enrollment_id}")
async def get_enrollment(
    enrollment_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.get(EnrollmentRequest, enrollment_id)
    if item is None or not may_access_enrollment(identity, item):
        raise ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment request not found")
    result = enrollment_json(item)
    instance = session.scalar(select(WorkbenchInstance).where(WorkbenchInstance.enrollment_request_id == item.id))
    if instance:
        result["workbench_instance_id"] = instance.id
    return result


def review_enrollment(
    enrollment_id: str,
    request: Request,
    identity: AuthenticatedPrincipal,
    session: Session,
    *,
    approved: bool,
    reason: str | None,
) -> dict:
    require_permission(identity, "workbench.enrollment.review")
    item = session.get(EnrollmentRequest, enrollment_id)
    if item is None:
        raise ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment request not found")
    if item.status != "PENDING_REVIEW" or aware(item.expires_at) <= utc_now():
        raise ApiError(409, "ENROLLMENT_STATE_INVALID", "Enrollment request cannot be reviewed")
    item.status = "APPROVED" if approved else "REJECTED"
    item.reviewer_id = identity.principal.id
    item.review_reason = reason
    item.reviewed_at = utc_now()
    record_audit(
        session,
        request,
        event_type="ENROLLMENT_APPROVED" if approved else "ENROLLMENT_REJECTED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="ENROLLMENT_REQUEST",
        target_id=item.id,
        domain_id=item.domain_id_snapshot,
        department_id=item.department_id_snapshot,
        summary="Approved workbench enrollment" if approved else "Rejected workbench enrollment",
    )
    session.commit()
    return enrollment_json(item)


@router.post("/api/v1/workbench-enrollments/{enrollment_id}/approve")
async def approve_enrollment(
    enrollment_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    return review_enrollment(enrollment_id, request, identity, session, approved=True, reason=None)


@router.post("/api/v1/workbench-enrollments/{enrollment_id}/reject")
async def reject_enrollment(
    enrollment_id: str,
    body: RejectBody,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    return review_enrollment(enrollment_id, request, identity, session, approved=False, reason=body.reason)


@router.post("/api/v1/workbench-enrollments/{enrollment_id}/challenge", status_code=status.HTTP_201_CREATED)
async def issue_challenge(
    enrollment_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.get(EnrollmentRequest, enrollment_id)
    if item is None or item.owner_principal_id != identity.principal.id:
        raise ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment request not found")
    if item.status != "APPROVED":
        raise ApiError(409, "ENROLLMENT_PENDING_REVIEW", "Enrollment is not approved")
    nonce = secrets.token_urlsafe(32)
    challenge = EnrollmentChallenge(
        id=str(uuid4()),
        enrollment_request_id=item.id,
        nonce_hash=hashlib.sha256(nonce.encode()).hexdigest(),
        status="ACTIVE",
        expires_at=utc_now() + timedelta(seconds=request.app.state.settings.challenge_ttl_seconds),
    )
    session.add(challenge)
    record_audit(
        session,
        request,
        event_type="ENROLLMENT_CHALLENGE_ISSUED",
        category="SECURITY",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="ENROLLMENT_REQUEST",
        target_id=item.id,
        domain_id=item.domain_id_snapshot,
        department_id=item.department_id_snapshot,
        summary="Issued one-time enrollment challenge",
    )
    session.commit()
    return {"challenge_id": challenge.id, "nonce": nonce, "expires_at": challenge.expires_at}


@router.post("/api/v1/workbench-enrollments/{enrollment_id}/complete")
async def complete_enrollment(
    enrollment_id: str,
    body: ProofBody,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.get(EnrollmentRequest, enrollment_id)
    if item is None or item.owner_principal_id != identity.principal.id:
        raise ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment request not found")
    unverified = jwt.decode(body.proof_jwt, options={"verify_signature": False})
    challenge_id = unverified.get("challenge_id")
    challenge = session.get(EnrollmentChallenge, challenge_id) if isinstance(challenge_id, str) else None
    if challenge is None or challenge.enrollment_request_id != item.id:
        raise ApiError(401, "KEY_PROOF_INVALID", "Key proof is invalid")
    if challenge.status != "ACTIVE":
        raise ApiError(409, "CHALLENGE_ALREADY_USED", "Challenge has already been used")
    if aware(challenge.expires_at) <= utc_now():
        challenge.status = "EXPIRED"
        session.commit()
        raise ApiError(410, "CHALLENGE_EXPIRED", "Challenge has expired")
    audience = f"{request.app.state.settings.platform_base_url}/api/v1/workbench-enrollments/{item.id}/complete"
    try:
        claims = verify_es256_jwt(body.proof_jwt, item.public_jwk, audience=audience)
    except InvalidProof as exc:
        raise ApiError(401, "KEY_PROOF_INVALID", "Key proof is invalid") from exc
    expected = {
        "enrollment_request_id": item.id,
        "challenge_id": challenge.id,
        "installation_id": item.installation_id,
    }
    if any(claims.get(key) != value for key, value in expected.items()):
        raise ApiError(401, "KEY_PROOF_INVALID", "Key proof is invalid")
    nonce = claims.get("nonce")
    if not isinstance(nonce, str) or not secrets.compare_digest(
        hashlib.sha256(nonce.encode()).hexdigest(), challenge.nonce_hash
    ):
        raise ApiError(401, "KEY_PROOF_INVALID", "Key proof is invalid")
    if session.get(UsedJti, {"jti": claims["jti"], "purpose": "ENROLLMENT_PROOF"}):
        raise ApiError(409, "CHALLENGE_ALREADY_USED", "Challenge has already been used")

    instance_id = str(uuid4())
    credential_id = str(uuid4())
    instance = WorkbenchInstance(
        id=instance_id,
        enrollment_request_id=item.id,
        owner_principal_id=item.owner_principal_id,
        domain_id=item.domain_id_snapshot,
        department_id=item.department_id_snapshot,
        team_id=item.team_id_snapshot,
        installation_id=item.installation_id,
        display_name=item.display_name,
        status="ACTIVE",
        credential_id=credential_id,
        reported_version=item.version,
        reported_os=item.os,
        reported_arch=item.arch,
    )
    credential = MachineCredential(
        id=credential_id,
        workbench_instance_id=instance_id,
        public_jwk=item.public_jwk,
        public_key_thumbprint=item.public_key_thumbprint,
        algorithm="ES256",
        status="ACTIVE",
    )
    session.add_all(
        [
            instance,
            credential,
            UsedJti(jti=claims["jti"], purpose="ENROLLMENT_PROOF", expires_at=datetime.fromtimestamp(claims["exp"], UTC)),
        ]
    )
    challenge.status = "USED"
    challenge.used_at = utc_now()
    item.status = "COMPLETED"
    record_audit(
        session,
        request,
        event_type="WORKBENCH_REGISTERED",
        category="SECURITY",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="WORKBENCH_INSTANCE",
        target_id=instance.id,
        domain_id=item.domain_id_snapshot,
        department_id=item.department_id_snapshot,
        summary=f"Registered workbench with key thumbprint {item.public_key_thumbprint}",
    )
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise ApiError(409, "ENROLLMENT_CONFLICT", "Enrollment was completed concurrently") from exc
    return {"workbench_instance_id": instance.id, "credential_id": credential.id, "status": "ACTIVE"}


@router.post("/oauth2/workbench/token")
async def machine_token(
    request: Request,
    grant_type: str = Form(),
    client_id: str = Form(),
    client_assertion_type: str = Form(),
    client_assertion: str = Form(min_length=20, max_length=8192),
    scope: str = Form(),
    session: Session = Depends(get_session),
) -> dict:
    expected_type = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    if grant_type != "client_credentials" or client_assertion_type != expected_type or scope != "workbench.heartbeat":
        raise ApiError(400, "CLIENT_ASSERTION_INVALID", "Machine token request is invalid")
    instance = session.get(WorkbenchInstance, client_id)
    credential = session.scalar(select(MachineCredential).where(MachineCredential.workbench_instance_id == client_id))
    if instance is None or credential is None or instance.status != "ACTIVE" or credential.status != "ACTIVE":
        raise ApiError(401, "MACHINE_CREDENTIAL_REVOKED", "Machine credential is invalid")
    audience = f"{request.app.state.settings.platform_base_url}/oauth2/workbench/token"
    try:
        claims = verify_es256_jwt(
            client_assertion,
            credential.public_jwk,
            audience=audience,
            issuer=client_id,
            subject=client_id,
        )
    except InvalidProof as exc:
        raise ApiError(401, "CLIENT_ASSERTION_INVALID", "Machine client assertion is invalid") from exc
    if session.get(UsedJti, {"jti": claims["jti"], "purpose": "CLIENT_ASSERTION"}):
        raise ApiError(401, "CLIENT_ASSERTION_REPLAYED", "Machine client assertion was already used")
    now = utc_now()
    expires = now + timedelta(seconds=request.app.state.settings.machine_token_ttl_seconds)
    session.add(UsedJti(jti=claims["jti"], purpose="CLIENT_ASSERTION", expires_at=datetime.fromtimestamp(claims["exp"], UTC)))
    access_token = jwt.encode(
        {
            "iss": request.app.state.settings.platform_base_url,
            "sub": instance.id,
            "aud": "workbench-api",
            "scope": "workbench.heartbeat",
            "iat": now,
            "exp": expires,
            "jti": str(uuid4()),
        },
        request.app.state.settings.machine_signing_secret,
        algorithm="HS256",
    )
    session.commit()
    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": request.app.state.settings.machine_token_ttl_seconds,
        "scope": "workbench.heartbeat",
    }


def machine_subject(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise ApiError(401, "MACHINE_CREDENTIAL_INVALID", "Machine token is required")
    try:
        claims = jwt.decode(
            authorization.removeprefix("Bearer "),
            request.app.state.settings.machine_signing_secret,
            algorithms=["HS256"],
            audience="workbench-api",
            issuer=request.app.state.settings.platform_base_url,
            options={"require": ["iss", "sub", "aud", "scope", "iat", "exp", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise ApiError(401, "MACHINE_CREDENTIAL_INVALID", "Machine token is invalid") from exc
    if claims.get("scope") != "workbench.heartbeat":
        raise ApiError(403, "TOKEN_SCOPE_INSUFFICIENT", "Machine token scope is insufficient")
    return claims["sub"]


@router.post("/api/v1/workbenches/{workbench_id}/heartbeat")
async def heartbeat(
    workbench_id: str,
    body: HeartbeatBody,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    if machine_subject(request) != workbench_id:
        raise ApiError(403, "TARGET_WORKBENCH_MISMATCH", "Machine token does not match target workbench")
    item = session.get(WorkbenchInstance, workbench_id)
    credential = session.scalar(select(MachineCredential).where(MachineCredential.workbench_instance_id == workbench_id))
    if item is None or credential is None or item.status != "ACTIVE" or credential.status != "ACTIVE":
        raise ApiError(401, "MACHINE_CREDENTIAL_REVOKED", "Machine credential has been revoked")
    first = item.first_heartbeat_at is None
    received_at = utc_now()
    if item.last_heartbeat_event_id != body.event_id:
        item.last_heartbeat_at = received_at
        item.last_heartbeat_event_id = body.event_id
        item.reported_version = body.workbench_version
    if first:
        item.first_heartbeat_at = received_at
        record_audit(
            session,
            request,
            event_type="WORKBENCH_FIRST_HEARTBEAT",
            category="SECURITY",
            actor_type="MACHINE",
            actor_id=item.id,
            target_type="WORKBENCH_INSTANCE",
            target_id=item.id,
            domain_id=item.domain_id,
            department_id=item.department_id,
            summary="Accepted first authenticated workbench heartbeat",
        )
    session.commit()
    return {"received_at": received_at, "connection_status": "ONLINE"}


def workbench_scope(identity: AuthenticatedPrincipal):
    clauses = []
    for assignment in identity.authorization.assignments:
        if "workbench.read" not in ROLE_PERMISSIONS[assignment.role]:
            continue
        scope = assignment.data_scope
        if scope.scope_type is ScopeType.GLOBAL:
            return true()
        if scope.scope_type is ScopeType.SELF:
            clauses.append(WorkbenchInstance.owner_principal_id == identity.principal.id)
        elif scope.scope_type is ScopeType.ALL_DEPARTMENTS:
            clauses.append(WorkbenchInstance.domain_id == scope.domain_id)
        elif scope.scope_type is ScopeType.DEPARTMENT_SET:
            clauses.append(
                (WorkbenchInstance.domain_id == scope.domain_id)
                & WorkbenchInstance.department_id.in_(scope.department_ids)
            )
    return or_(*clauses) if clauses else false()


@router.get("/api/v1/workbenches")
async def list_workbenches(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "workbench.read")
    rows = session.scalars(
        select(WorkbenchInstance).where(workbench_scope(identity)).order_by(WorkbenchInstance.created_at.desc())
    ).all()
    return [workbench_json(row, request.app.state.settings.heartbeat_offline_seconds) for row in rows]


@router.get("/api/v1/workbenches/{workbench_id}")
async def get_workbench(
    workbench_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.scalar(
        select(WorkbenchInstance).where(WorkbenchInstance.id == workbench_id, workbench_scope(identity))
    )
    if item is None:
        raise ApiError(404, "WORKBENCH_NOT_FOUND", "Workbench not found")
    return workbench_json(item, request.app.state.settings.heartbeat_offline_seconds)


@router.post("/api/v1/workbenches/{workbench_id}/revoke")
async def revoke_workbench(
    workbench_id: str,
    body: RevokeBody,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "workbench.revoke")
    item = session.get(WorkbenchInstance, workbench_id)
    credential = session.scalar(select(MachineCredential).where(MachineCredential.workbench_instance_id == workbench_id))
    if item is None or credential is None:
        raise ApiError(404, "WORKBENCH_NOT_FOUND", "Workbench not found")
    if item.status != "ACTIVE":
        raise ApiError(409, "WORKBENCH_ALREADY_REVOKED", "Workbench is already revoked")
    now = utc_now()
    item.status = "REVOKED"
    item.revoked_by = identity.principal.id
    item.revoked_at = now
    item.revoke_reason = body.reason
    credential.status = "REVOKED"
    credential.revoked_at = now
    record_audit(
        session,
        request,
        event_type="WORKBENCH_REVOKED",
        category="SECURITY",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="WORKBENCH_INSTANCE",
        target_id=item.id,
        domain_id=item.domain_id,
        department_id=item.department_id,
        summary="Revoked platform access for workbench",
    )
    session.commit()
    return workbench_json(item, request.app.state.settings.heartbeat_offline_seconds)
