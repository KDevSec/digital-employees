from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, true
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.audit import record_audit
from app.database import get_session
from app.domain.authorization import ROLE_PERMISSIONS, ScopeType
from app.errors import ApiError
from app.models import AuditEvent, IamDepartment, IamDomain, IamPrincipal, PlatformSetting, utc_now


router = APIRouter()


@router.get("/.well-known/workbench-configuration")
async def workbench_configuration(request: Request) -> dict:
    settings = request.app.state.settings
    return {
        "platform_base_url": settings.platform_base_url,
        "oidc_issuer": settings.oidc_issuer,
        "oidc_client_id": "workbench-desktop",
        "enrollment_endpoint": f"{settings.platform_base_url}/api/v1/workbench-enrollments",
        "machine_token_endpoint": f"{settings.platform_base_url}/oauth2/workbench/token",
        "protocol_version": "1",
    }


@router.get("/api/v1/me")
async def me(identity: AuthenticatedPrincipal = Depends(get_current_principal)) -> dict:
    principal = identity.principal
    permissions = sorted(
        set().union(*(ROLE_PERMISSIONS[assignment.role] for assignment in identity.authorization.assignments))
    )
    return {
        "principal": {
            "id": principal.id,
            "username": principal.username,
            "display_name": principal.display_name,
            "email": principal.email,
            "domain_id": principal.domain_id,
            "department_id": principal.department_id,
            "team_id": principal.team_id,
        },
        "roles": [
            {
                "role_code": assignment.role,
                "scope_type": assignment.data_scope.scope_type,
                "domain_id": assignment.data_scope.domain_id,
                "department_ids": sorted(assignment.data_scope.department_ids),
            }
            for assignment in identity.authorization.assignments
        ],
        "permissions": permissions,
    }


def require_iam_reader(identity: AuthenticatedPrincipal) -> None:
    if not any(assignment.role.value != "EMPLOYEE" for assignment in identity.authorization.assignments):
        raise ApiError(403, "PERMISSION_DENIED", "IAM context is available to administrators only")


@router.get("/api/v1/iam/domains")
async def iam_domains(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_iam_reader(identity)
    return [
        {"id": row.id, "name": row.name, "status": row.status}
        for row in session.scalars(select(IamDomain).order_by(IamDomain.name)).all()
    ]


@router.get("/api/v1/iam/domains/{domain_id}/departments")
async def iam_departments(
    domain_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_iam_reader(identity)
    return [
        {"id": row.id, "domain_id": row.domain_id, "name": row.name, "status": row.status}
        for row in session.scalars(
            select(IamDepartment).where(IamDepartment.domain_id == domain_id).order_by(IamDepartment.name)
        ).all()
    ]


@router.get("/api/v1/iam/principals")
async def iam_principals(
    request: Request,
    query: str = Query(default="", max_length=100),
    domain_id: str | None = None,
    department_id: str | None = None,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_iam_reader(identity)
    if not request.app.state.settings.testing:
        await request.app.state.oidc.sync_directory(session)
    statement = select(IamPrincipal)
    if query:
        pattern = f"%{query}%"
        statement = statement.where(
            or_(
                IamPrincipal.username.ilike(pattern),
                IamPrincipal.display_name.ilike(pattern),
                IamPrincipal.email.ilike(pattern),
            )
        )
    if domain_id:
        statement = statement.where(IamPrincipal.domain_id == domain_id)
    if department_id:
        statement = statement.where(IamPrincipal.department_id == department_id)
    return [
        {
            "id": row.id,
            "username": row.username,
            "display_name": row.display_name,
            "email": row.email,
            "domain_id": row.domain_id,
            "department_id": row.department_id,
            "team_id": row.team_id,
            "status": row.status,
        }
        for row in session.scalars(statement.order_by(IamPrincipal.display_name).limit(100)).all()
    ]


class SettingsUpdate(BaseModel):
    challenge_ttl_seconds: int = Field(ge=60, le=900)
    machine_token_ttl_seconds: int = Field(ge=60, le=300)
    heartbeat_offline_seconds: int = Field(ge=30, le=3600)


SETTINGS_KEYS = tuple(SettingsUpdate.model_fields)


def settings_json(request: Request, session: Session) -> dict:
    values = {
        "oidc_issuer": request.app.state.settings.oidc_issuer,
        "platform_base_url": request.app.state.settings.platform_base_url,
        "package_storage_path": str(request.app.state.settings.package_storage_path),
    }
    for key in SETTINGS_KEYS:
        row = session.get(PlatformSetting, key)
        values[key] = row.value if row else getattr(request.app.state.settings, key)
    return values


@router.get("/api/v1/platform-settings")
async def get_platform_settings(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "platform.settings.manage")
    return settings_json(request, session)


@router.put("/api/v1/platform-settings")
async def update_platform_settings(
    body: SettingsUpdate,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "platform.settings.manage")
    for key, value in body.model_dump().items():
        item = session.get(PlatformSetting, key)
        if item is None:
            item = PlatformSetting(key=key, value=value, updated_by=identity.principal.id)
            session.add(item)
        else:
            item.value = value
            item.updated_by = identity.principal.id
            item.updated_at = utc_now()
        setattr(request.app.state.settings, key, value)
    record_audit(
        session,
        request,
        event_type="PLATFORM_SETTINGS_UPDATED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="PLATFORM_SETTINGS",
        target_id=None,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary="Updated V0.1 runtime settings",
    )
    session.commit()
    return settings_json(request, session)


def audit_permission_categories(identity: AuthenticatedPrincipal) -> set[str]:
    permissions = set().union(*(ROLE_PERMISSIONS[a.role] for a in identity.authorization.assignments))
    if "audit.all.read" in permissions:
        return {"OPERATION", "SECURITY", "AUTH"}
    result = set()
    if "audit.operation.read" in permissions:
        result.update({"OPERATION", "AUTH"})
    if "audit.security.read" in permissions:
        result.add("SECURITY")
    return result


def audit_scope(identity: AuthenticatedPrincipal):
    clauses = []
    for assignment in identity.authorization.assignments:
        if not ROLE_PERMISSIONS[assignment.role].intersection(
            {"audit.operation.read", "audit.security.read", "audit.all.read"}
        ):
            continue
        scope = assignment.data_scope
        if scope.scope_type is ScopeType.GLOBAL:
            return true()
        if scope.scope_type is ScopeType.ALL_DEPARTMENTS:
            clauses.append(AuditEvent.domain_id_snapshot == scope.domain_id)
        elif scope.scope_type is ScopeType.DEPARTMENT_SET:
            clauses.append(
                (AuditEvent.domain_id_snapshot == scope.domain_id)
                & AuditEvent.department_id_snapshot.in_(scope.department_ids)
            )
    return or_(*clauses) if clauses else (AuditEvent.id == "")


@router.get("/api/v1/audit-events")
async def audit_events(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
    event_type: str | None = Query(default=None, max_length=80),
    result: str | None = Query(default=None, max_length=20),
    actor_id: str | None = Query(default=None, max_length=100),
    workbench_id: str | None = Query(default=None, max_length=100),
    occurred_from: datetime | None = None,
    occurred_to: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[dict]:
    categories = audit_permission_categories(identity)
    if not categories:
        raise ApiError(403, "PERMISSION_DENIED", "Audit access is not permitted")
    statement = select(AuditEvent).where(AuditEvent.category.in_(categories), audit_scope(identity))
    if event_type:
        statement = statement.where(AuditEvent.event_type == event_type)
    if result:
        statement = statement.where(AuditEvent.result == result)
    if actor_id:
        statement = statement.where(AuditEvent.actor_id == actor_id)
    if workbench_id:
        statement = statement.where(AuditEvent.target_id == workbench_id)
    if occurred_from:
        statement = statement.where(AuditEvent.occurred_at >= occurred_from)
    if occurred_to:
        statement = statement.where(AuditEvent.occurred_at <= occurred_to)
    rows = session.scalars(statement.order_by(AuditEvent.occurred_at.desc()).limit(limit)).all()
    return [
        {
            "id": row.id,
            "event_type": row.event_type,
            "category": row.category,
            "actor_type": row.actor_type,
            "actor_id": row.actor_id,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "domain_id": row.domain_id_snapshot,
            "department_id": row.department_id_snapshot,
            "result": row.result,
            "reason_code": row.reason_code,
            "summary": row.summary,
            "occurred_at": row.occurred_at,
            "trace_id": row.trace_id,
        }
        for row in rows
    ]
