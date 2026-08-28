import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, Form, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import false, func, or_, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.api.core import PaginatedResponse
from app.audit import record_audit
from app.database import get_session
from app.domain.authorization import ROLE_PERMISSIONS, ScopeType
from app.domain.crypto import InvalidProof, jwk_thumbprint, verify_es256_jwt
from app.domain.organization import descendant_org_ids
from app.domain.scoped_visibility import (
    can_review_scoped,
    descendant_org_ids as scoped_descendant_org_ids,
    has_global_permission,
    org_path,
    owner_org_context,
    visible_org_ids,
)
from app.errors import ApiError
from app.models import (
    EnrollmentChallenge,
    EnrollmentRequest,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    MachineCredential,
    UsedJti,
    WorkbenchInstance,
    utc_now,
)

logger = logging.getLogger("platform.enrollment")


router = APIRouter()


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class TerminalMetadata(BaseModel):
    hostname: str | None = Field(default=None, max_length=255)
    mac_address: str | None = Field(default=None, max_length=32)


def client_public_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return None


def apply_terminal_metadata(target, meta: TerminalMetadata | None, public_ip: str | None) -> None:
    if meta is not None:
        target.hostname = meta.hostname
        if meta.mac_address:
            target.mac_addresses = [meta.mac_address]
    if public_ip:
        target.public_ip = public_ip


def terminal_metadata_dict(item) -> dict:
    macs = getattr(item, "mac_addresses", None) or []
    return {
        "hostname": getattr(item, "hostname", None),
        "mac_address": macs[0] if macs else None,
        "ip_address": getattr(item, "public_ip", None),
    }


class EnrollmentCreate(BaseModel):
    installation_id: UUID
    public_key: dict[str, str]
    display_name: str = Field(min_length=1, max_length=200)
    workbench_version: str = Field(min_length=1, max_length=50)
    os: str = Field(min_length=1, max_length=30)
    arch: str = Field(min_length=1, max_length=30)
    metadata: TerminalMetadata | None = None


class RejectBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ProofBody(BaseModel):
    proof_jwt: str = Field(min_length=20, max_length=8192)


class HeartbeatBody(BaseModel):
    event_id: str = Field(min_length=1, max_length=100)
    reported_at: datetime
    workbench_version: str = Field(min_length=1, max_length=50)
    metadata: TerminalMetadata | None = None


class RevokeBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def enrollment_json(item: EnrollmentRequest, session: Session) -> dict:
    owner = session.get(IamPrincipal, item.owner_principal_id)
    owner_name, owner_org_path, org_nodes = owner_org_context(
        session, owner, item.owner_primary_org_id
    )
    result = {
        "id": item.id,
        "owner_principal_id": item.owner_principal_id,
        "owner_display_name": owner_name,
        "org_path": owner_org_path,
        "org_path_nodes": org_nodes,
        "domain_id": item.domain_id_snapshot,
        "department_id": item.department_id_snapshot,
        "installation_id": item.installation_id,
        "display_name": item.display_name,
        "workbench_version": item.version,
        "os": item.os,
        "arch": item.arch,
        **terminal_metadata_dict(item),
        "status": item.status,
        "reviewer_id": item.reviewer_id,
        "review_reason": item.review_reason,
        "created_at": item.created_at,
        "expires_at": item.expires_at,
    }
    return result


def workbench_json(item: WorkbenchInstance, session: Session, offline_seconds: int) -> dict:
    now = utc_now()
    owner = session.get(IamPrincipal, item.owner_principal_id)
    owner_name, owner_org_path, org_nodes = owner_org_context(session, owner)
    online = (
        item.status == "ACTIVE"
        and item.last_heartbeat_at is not None
        and now - aware(item.last_heartbeat_at) <= timedelta(seconds=offline_seconds)
    )
    return {
        "kind": "workbench",
        "enrollment_id": item.enrollment_request_id,
        "id": item.id,
        "owner_principal_id": item.owner_principal_id,
        "owner_display_name": owner_name,
        "org_path": owner_org_path,
        "org_path_nodes": org_nodes,
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
        **terminal_metadata_dict(item),
        "first_heartbeat_at": item.first_heartbeat_at,
        "last_heartbeat_at": item.last_heartbeat_at,
        "created_at": item.created_at,
    }


def enrollment_as_workbench_json(item: EnrollmentRequest, session: Session) -> dict:
    owner = session.get(IamPrincipal, item.owner_principal_id)
    owner_name, owner_org_path, org_nodes = owner_org_context(
        session, owner, item.owner_primary_org_id
    )
    connection_status = "REJECTED" if item.status == "REJECTED" else "PENDING"
    return {
        "kind": "enrollment",
        "enrollment_id": item.id,
        "id": item.id,
        "owner_principal_id": item.owner_principal_id,
        "owner_display_name": owner_name,
        "org_path": owner_org_path,
        "org_path_nodes": org_nodes,
        "domain_id": item.domain_id_snapshot,
        "department_id": item.department_id_snapshot,
        "team_id": item.team_id_snapshot,
        "installation_id": item.installation_id,
        "display_name": item.display_name,
        "status": item.status,
        "credential_status": connection_status,
        "connection_status": connection_status,
        "reported_version": item.version,
        "reported_os": item.os,
        "reported_arch": item.arch,
        **terminal_metadata_dict(item),
        "first_heartbeat_at": None,
        "last_heartbeat_at": None,
        "created_at": item.created_at,
        "review_reason": item.review_reason,
    }


def may_access_enrollment(session: Session, identity: AuthenticatedPrincipal, item: EnrollmentRequest) -> bool:
    if item.owner_principal_id == identity.principal.id:
        return True
    return can_review_scoped(session, identity, item.owner_primary_org_id)



def supersede_enrollment(
    session: Session,
    request: Request,
    old: EnrollmentRequest,
    principal: IamPrincipal,
) -> None:
    """作废旧接入申请（023）：置 CANCELLED 并改写 thumbprint 以释放身份唯一键，供同身份重新申请。"""
    old.status = "CANCELLED"
    old.review_reason = (old.review_reason or "") + " [superseded by a resubmission]"
    old.public_key_thumbprint = f"superseded:{old.id}:{old.public_key_thumbprint}"[:100]
    record_audit(
        session,
        request,
        event_type="ENROLLMENT_SUPERSEDED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=principal.id,
        target_type="ENROLLMENT_REQUEST",
        target_id=old.id,
        domain_id=old.domain_id_snapshot,
        department_id=old.department_id_snapshot,
        summary="Previous enrollment superseded by a resubmission",
    )


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
    if existing is not None:
        active_instance = session.scalar(
            select(WorkbenchInstance).where(
                WorkbenchInstance.owner_principal_id == identity.principal.id,
                WorkbenchInstance.status == "ACTIVE",
            )
        )
        if active_instance is not None:
            logger.info(
                "enrollment submission returned existing (active terminal present)",
                extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "enrollment_id": existing.id},
            )
            return enrollment_json(existing, session)
        # 无 ACTIVE 终端：旧申请作废（023），释放唯一键后用当前身份重新快照建 PENDING，
        # 覆盖「被拒绝后重申」与「组织变动后重申，新管理员需可见」两类场景。
        supersede_enrollment(session, request, existing, identity.principal)
    item = EnrollmentRequest(
        id=str(uuid4()),
        owner_principal_id=identity.principal.id,
        owner_primary_org_id=identity.principal.primary_org_id,
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
    apply_terminal_metadata(item, body.metadata, client_public_ip(request))
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
        logger.info("duplicate enrollment submission returned existing", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "enrollment_id": existing.id})
        return enrollment_json(existing, session)
    logger.info("enrollment request submitted", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "enrollment_id": item.id})
    return enrollment_json(item, session)


@router.get("/api/v1/workbench-enrollments")
async def list_enrollments(
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    from sqlalchemy import func
    can_review = has_global_permission(identity, "workbench.enrollment.review") or any(
        "workbench.enrollment.review" in ROLE_PERMISSIONS[a.role]
        for a in identity.authorization.assignments
    ) or any(
        "workbench.enrollment.review" in grant.permissions
        for grant in identity.authorization.scoped_grants
    )
    base = select(EnrollmentRequest)
    if can_review:
        visible = visible_org_ids(session, identity, "workbench.enrollment.review")
        if visible is not None:
            base = base.where(EnrollmentRequest.owner_primary_org_id.in_(visible))
    else:
        base = base.where(EnrollmentRequest.owner_principal_id == identity.principal.id)
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    rows = session.scalars(base.order_by(EnrollmentRequest.created_at.desc()).offset(offset).limit(limit)).all()
    return PaginatedResponse(
        items=[enrollment_json(row, session) for row in rows],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.get("/api/v1/workbench-enrollments/{enrollment_id}")
async def get_enrollment(
    enrollment_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.get(EnrollmentRequest, enrollment_id)
    if item is None or not may_access_enrollment(session, identity, item):
        raise ApiError(404, "ENROLLMENT_NOT_FOUND", "Enrollment request not found")
    result = enrollment_json(item, session)
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
    if not can_review_scoped(session, identity, item.owner_primary_org_id):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
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
    logger.info(
        "enrollment %s", "approved" if approved else "rejected",
        extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "enrollment_id": item.id, "event_type": "ENROLLMENT_APPROVED" if approved else "ENROLLMENT_REJECTED"},
    )
    return enrollment_json(item, session)


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
        hostname=item.hostname,
        mac_addresses=item.mac_addresses,
        public_ip=client_public_ip(request),
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
    logger.info("workbench registered", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "workbench_id": instance.id, "enrollment_id": item.id})
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
        apply_terminal_metadata(item, body.metadata, client_public_ip(request))
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


def workbench_scope(session: Session, identity: AuthenticatedPrincipal):
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
            descendant_ids = descendant_org_ids(session, set(scope.department_ids))
            clauses.append(
                (WorkbenchInstance.domain_id == scope.domain_id)
                & WorkbenchInstance.department_id.in_(descendant_ids)
            )
    return or_(*clauses) if clauses else false()


@router.get("/api/v1/workbenches")
async def list_workbenches(
    request: Request,
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    q: str = Query(default="", max_length=100),
    org_id: str | None = Query(default=None, max_length=64),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    require_permission(identity, "workbench.read")
    from sqlalchemy import func
    wb_base = select(WorkbenchInstance).join(
        IamPrincipal, IamPrincipal.id == WorkbenchInstance.owner_principal_id
    )
    visible = visible_org_ids(session, identity, "workbench.read")
    if visible is not None:
        scoped_clause = WorkbenchInstance.owner_principal_id == identity.principal.id
        if visible:
            scoped_clause = scoped_clause | IamPrincipal.primary_org_id.in_(visible)
        wb_base = wb_base.where(or_(workbench_scope(session, identity), scoped_clause))
    keyword = q.strip()
    matching_org_ids = None
    if keyword:
        like = f"%{keyword}%"
        matching_org_ids = (
            select(IamOrgClosure.descendant_id)
            .join(IamOrgNode, IamOrgNode.id == IamOrgClosure.ancestor_id)
            .where(IamOrgNode.name.ilike(like))
        )
        wb_base = wb_base.where(
            or_(
                IamPrincipal.username.ilike(like),
                IamPrincipal.display_name.ilike(like),
                IamPrincipal.primary_org_id.in_(matching_org_ids),
            )
        )
    selected_org_ids = scoped_descendant_org_ids(session, {org_id}) if org_id else None
    if selected_org_ids:
        wb_base = wb_base.where(IamPrincipal.primary_org_id.in_(selected_org_ids))
    wb_total = session.scalar(select(func.count()).select_from(wb_base.subquery()))

    enrollment_base = select(EnrollmentRequest).join(
        IamPrincipal, IamPrincipal.id == EnrollmentRequest.owner_principal_id
    ).where(EnrollmentRequest.status.in_(["PENDING_REVIEW", "APPROVED", "REJECTED"]))
    if visible is not None:
        enrollment_visible_clause = EnrollmentRequest.owner_principal_id == identity.principal.id
        if visible:
            enrollment_visible_clause = enrollment_visible_clause | EnrollmentRequest.owner_primary_org_id.in_(visible)
        enrollment_base = enrollment_base.where(enrollment_visible_clause)
    if keyword:
        like = f"%{keyword}%"
        enrollment_base = enrollment_base.where(
            or_(
                IamPrincipal.username.ilike(like),
                IamPrincipal.display_name.ilike(like),
                EnrollmentRequest.owner_primary_org_id.in_(matching_org_ids),
            )
        )
    if selected_org_ids:
        enrollment_base = enrollment_base.where(EnrollmentRequest.owner_primary_org_id.in_(selected_org_ids))
    enrollment_total = session.scalar(select(func.count()).select_from(enrollment_base.subquery()))

    wb_rows = session.scalars(
        wb_base.order_by(WorkbenchInstance.created_at.desc()).limit(offset + limit)
    ).all()
    enrollment_rows = session.scalars(
        enrollment_base.order_by(EnrollmentRequest.created_at.desc()).limit(offset + limit)
    ).all()
    items = [
        *(workbench_json(row, session, request.app.state.settings.heartbeat_offline_seconds) for row in wb_rows),
        *(enrollment_as_workbench_json(row, session) for row in enrollment_rows),
    ]
    items.sort(key=lambda item: item["created_at"], reverse=True)
    page = items[offset:offset + limit]
    return PaginatedResponse(
        items=page,
        total=(wb_total or 0) + (enrollment_total or 0),
        offset=offset,
        limit=limit,
    )


@router.get("/api/v1/workbenches/{workbench_id}")
async def get_workbench(
    workbench_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    base = select(WorkbenchInstance).join(
        IamPrincipal, IamPrincipal.id == WorkbenchInstance.owner_principal_id
    ).where(WorkbenchInstance.id == workbench_id)
    visible = visible_org_ids(session, identity, "workbench.read")
    if visible is not None:
        scoped_clause = WorkbenchInstance.owner_principal_id == identity.principal.id
        if visible:
            scoped_clause = scoped_clause | IamPrincipal.primary_org_id.in_(visible)
        base = base.where(or_(workbench_scope(session, identity), scoped_clause))
    item = session.scalar(base)
    if item is None:
        raise ApiError(404, "WORKBENCH_NOT_FOUND", "Workbench not found")
    return workbench_json(item, session, request.app.state.settings.heartbeat_offline_seconds)


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
    logger.info("workbench revoked", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "workbench_id": item.id})
    return workbench_json(item, session, request.app.state.settings.heartbeat_offline_seconds)


def roster_install_status(
    instance: WorkbenchInstance | None,
    enrollment: EnrollmentRequest | None,
    offline_seconds: int,
    now: datetime,
) -> str:
    if instance is not None and instance.status == "ACTIVE":
        online = (
            instance.last_heartbeat_at is not None
            and now - aware(instance.last_heartbeat_at) <= timedelta(seconds=offline_seconds)
        )
        return "ONLINE" if online else "OFFLINE"
    if enrollment is not None:
        if enrollment.status in ("PENDING_REVIEW", "APPROVED"):
            return "PENDING"
        if enrollment.status == "REJECTED":
            return "REJECTED"
    return "NOT_INSTALLED"


def roster_row(
    principal: IamPrincipal,
    instance: WorkbenchInstance | None,
    enrollment: EnrollmentRequest | None,
    session: Session,
    offline_seconds: int,
) -> dict:
    now = utc_now()
    owner_name, org_path_str, org_nodes = owner_org_context(session, principal)
    status = roster_install_status(instance, enrollment, offline_seconds, now)
    meta_source = instance if instance is not None else enrollment
    row = {
        "kind": "roster",
        "id": instance.id if instance is not None else (enrollment.id if enrollment is not None else None),
        "enrollment_id": enrollment.id if enrollment is not None else None,
        "principal_id": principal.id,
        "owner_principal_id": principal.id,
        "owner_display_name": owner_name,
        "username": principal.username,
        "email": principal.email,
        "org_path": org_path_str,
        "org_path_nodes": org_nodes,
        "department_id": principal.department_id,
        "team_id": principal.team_id,
        "install_status": status,
        "connection_status": status,
        "status": status,
        "display_name": (
            instance.display_name if instance is not None
            else (enrollment.display_name if enrollment is not None else None)
        ),
        "installation_id": (
            instance.installation_id if instance is not None
            else (enrollment.installation_id if enrollment is not None else None)
        ),
        "reported_version": (
            instance.reported_version if instance is not None
            else (enrollment.version if enrollment is not None else None)
        ),
        "reported_os": (
            instance.reported_os if instance is not None
            else (enrollment.os if enrollment is not None else None)
        ),
        "reported_arch": (
            instance.reported_arch if instance is not None
            else (enrollment.arch if enrollment is not None else None)
        ),
        "first_heartbeat_at": instance.first_heartbeat_at if instance is not None else None,
        "last_heartbeat_at": instance.last_heartbeat_at if instance is not None else None,
        "created_at": (
            instance.created_at if instance is not None
            else (enrollment.created_at if enrollment is not None else None)
        ),
        "review_reason": enrollment.review_reason if enrollment is not None else None,
    }
    if meta_source is not None:
        row.update(terminal_metadata_dict(meta_source))
    else:
        row.update({"hostname": None, "mac_address": None, "ip_address": None})
    return row


@router.get("/api/v1/terminal-roster")
async def terminal_roster(
    request: Request,
    scope: str = Query(default="me", pattern="^(me|team)$"),
    q: str = Query(default="", max_length=100),
    org_id: str | None = Query(default=None, max_length=64),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    require_permission(identity, "workbench.read")
    if scope == "team":
        require_permission(identity, "workbench.team.read")

    people = select(IamPrincipal).where(IamPrincipal.status == "ACTIVE")
    if scope == "me":
        people = people.where(IamPrincipal.id == identity.principal.id)
    else:
        visible = visible_org_ids(session, identity, "workbench.team.read")
        if visible is not None:
            if not visible:
                return PaginatedResponse(items=[], total=0, offset=offset, limit=limit)
            people = people.where(IamPrincipal.primary_org_id.in_(visible))
        elif not has_global_permission(identity, "workbench.team.read"):
            people = people.where(IamPrincipal.domain_id == identity.principal.domain_id)

    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        matching_org_ids = (
            select(IamOrgClosure.descendant_id)
            .join(IamOrgNode, IamOrgNode.id == IamOrgClosure.ancestor_id)
            .where(IamOrgNode.name.ilike(like))
        )
        people = people.where(
            or_(
                IamPrincipal.username.ilike(like),
                IamPrincipal.display_name.ilike(like),
                IamPrincipal.primary_org_id.in_(matching_org_ids),
            )
        )
    selected_org_ids = scoped_descendant_org_ids(session, {org_id}) if org_id else None
    if selected_org_ids:
        people = people.where(IamPrincipal.primary_org_id.in_(selected_org_ids))

    total = session.scalar(select(func.count()).select_from(people.subquery()))
    principals = session.scalars(
        people.order_by(IamPrincipal.display_name, IamPrincipal.username).offset(offset).limit(limit)
    ).all()
    principal_ids = [principal.id for principal in principals]

    instances: dict[str, WorkbenchInstance] = {}
    enrollments: dict[str, EnrollmentRequest] = {}
    if principal_ids:
        for inst in session.scalars(
            select(WorkbenchInstance).where(
                WorkbenchInstance.owner_principal_id.in_(principal_ids),
                WorkbenchInstance.status == "ACTIVE",
            )
        ).all():
            current = instances.get(inst.owner_principal_id)
            inst_key = inst.last_heartbeat_at or inst.created_at
            cur_key = (current.last_heartbeat_at or current.created_at) if current else None
            if current is None or (inst_key and (cur_key is None or inst_key > cur_key)):
                instances[inst.owner_principal_id] = inst
        for enr in session.scalars(
            select(EnrollmentRequest).where(
                EnrollmentRequest.owner_principal_id.in_(principal_ids),
                EnrollmentRequest.status.in_(["PENDING_REVIEW", "APPROVED", "REJECTED"]),
            )
        ).all():
            current = enrollments.get(enr.owner_principal_id)
            if current is None or enr.created_at > current.created_at:
                enrollments[enr.owner_principal_id] = enr

    offline_seconds = request.app.state.settings.heartbeat_offline_seconds
    items = [
        roster_row(principal, instances.get(principal.id), enrollments.get(principal.id), session, offline_seconds)
        for principal in principals
    ]
    return PaginatedResponse(items=items, total=total or 0, offset=offset, limit=limit)
