from datetime import datetime
import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import exists, false, func, or_, select, true
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.audit import record_audit
from app.database import get_session
from app.domain.authorization import ROLE_PERMISSIONS, ScopeType
from app.domain.organization import descendant_org_ids
from app.errors import ApiError
from app.logging_config import apply_log_level, apply_log_rotation
from app.models import (
    AuditEvent,
    IamDepartment,
    IamDomain,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    IamPrincipalOrg,
    IamTeam,
    PlatformSetting,
    RoleAssignment,
    utc_now,
)

logger = logging.getLogger("platform.core")


class PaginatedResponse(BaseModel):
    items: list[dict]
    total: int
    offset: int
    limit: int


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
async def me(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    principal = identity.principal
    permissions = sorted(
        set().union(*(ROLE_PERMISSIONS[assignment.role] for assignment in identity.authorization.assignments))
    )
    role_entries = []
    for assignment in identity.authorization.assignments:
        scope = assignment.data_scope
        managed_orgs: list[dict] = []
        if scope.scope_type is ScopeType.DEPARTMENT_SET and scope.department_ids:
            org_nodes = session.scalars(
                select(IamOrgNode).where(IamOrgNode.id.in_(tuple(scope.department_ids)))
            ).all()
            managed_orgs = [
                {"id": node.id, "name": node.name, "org_type": node.org_type}
                for node in org_nodes
            ]
        elif scope.scope_type is ScopeType.ALL_DEPARTMENTS and scope.domain_id:
            domain = session.get(IamDomain, scope.domain_id)
            if domain is not None:
                managed_orgs = [{"id": domain.id, "name": domain.name, "org_type": "DOMAIN"}]
        role_entries.append(
            {
                "role_code": assignment.role,
                "scope_type": scope.scope_type,
                "domain_id": scope.domain_id,
                "department_ids": sorted(scope.department_ids),
                "managed_orgs": managed_orgs,
            }
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
        "roles": role_entries,
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


@router.get("/api/v1/iam/departments")
async def iam_all_departments(
    request: Request,
    domain_id: str | None = None,
    query: str = Query(default="", max_length=100),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    require_iam_reader(identity)
    stmt = select(IamDepartment)
    if domain_id:
        stmt = stmt.where(IamDepartment.domain_id == domain_id)
    if query:
        stmt = stmt.where(IamDepartment.name.ilike(f"%{query}%"))
    total = session.scalar(select(func.count()).select_from(stmt.subquery()))
    dept_rows = session.scalars(stmt.order_by(IamDepartment.name).offset(offset).limit(limit)).all()
    domain_ids = {d.domain_id for d in dept_rows}
    domains = {
        d.id: d.name
        for d in session.scalars(select(IamDomain).where(IamDomain.id.in_(domain_ids))).all()
    }
    dept_ids = [d.id for d in dept_rows]
    principal_counts: dict[str, int] = {}
    org_node_map: dict[str, str] = {}
    if dept_ids:
        count_rows = session.execute(
            select(IamPrincipal.department_id, func.count(IamPrincipal.id))
            .where(IamPrincipal.department_id.in_(dept_ids), IamPrincipal.status == "ACTIVE")
            .group_by(IamPrincipal.department_id)
        ).all()
        principal_counts = {row[0]: row[1] for row in count_rows}
        org_nodes = session.scalars(
            select(IamOrgNode).where(IamOrgNode.id.in_(dept_ids))
        ).all()
        org_node_map = {n.id: n.name for n in org_nodes}
    return PaginatedResponse(
        items=[
            {
                "id": d.id,
                "domain_id": d.domain_id,
                "domain_name": domains.get(d.domain_id, ""),
                "name": d.name,
                "org_name": org_node_map.get(d.id, d.name),
                "status": d.status,
                "principal_count": principal_counts.get(d.id, 0),
            }
            for d in dept_rows
        ],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.get("/api/v1/iam/teams")
async def iam_teams(
    department_id: str | None = None,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_iam_reader(identity)
    statement = select(IamTeam)
    if department_id:
        statement = statement.where(IamTeam.department_id == department_id)
    return [
        {"id": row.id, "department_id": row.department_id, "name": row.name, "status": row.status}
        for row in session.scalars(statement.order_by(IamTeam.name)).all()
    ]


@router.get("/api/v1/iam/principals")
async def iam_principals(
    request: Request,
    query: str = Query(default="", max_length=100),
    domain_id: str | None = None,
    department_id: str | None = None,
    team_id: str | None = None,
    status: str | None = Query(default=None, max_length=20),
    role_code: str | None = Query(default=None, max_length=40),
    department_ids: list[str] | None = Query(default=None),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    require_iam_reader(identity)
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
    if team_id:
        statement = statement.where(IamPrincipal.team_id == team_id)
    if department_ids:
        descendant_ids = descendant_org_ids(session, set(department_ids))
        statement = statement.where(IamPrincipal.department_id.in_(descendant_ids))
    if status:
        statement = statement.where(IamPrincipal.status == status)
    if role_code:
        statement = statement.where(
            exists(
                select(RoleAssignment.id).where(
                    RoleAssignment.principal_id == IamPrincipal.id,
                    RoleAssignment.role_code == role_code,
                    RoleAssignment.status == "ACTIVE",
                )
            )
        )
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = session.scalars(statement.order_by(IamPrincipal.display_name).offset(offset).limit(limit)).all()
    dept_ids = {r.department_id for r in rows if r.department_id}
    domain_ids = {r.domain_id for r in rows if r.domain_id}
    dept_names = {
        d.id: d.name
        for d in session.scalars(select(IamDepartment).where(IamDepartment.id.in_(dept_ids))).all()
    }
    domain_names = {
        d.id: d.name
        for d in session.scalars(select(IamDomain).where(IamDomain.id.in_(domain_ids))).all()
    }
    principal_ids = [r.id for r in rows]
    role_map: dict[str, list[str]] = {}
    if principal_ids:
        role_rows = session.scalars(
            select(RoleAssignment).where(
                RoleAssignment.principal_id.in_(principal_ids),
                RoleAssignment.status == "ACTIVE",
            )
        ).all()
        for ra in role_rows:
            role_map.setdefault(ra.principal_id, []).append(ra.role_code)
    org_paths: dict[str, str] = {}
    primary_org_ids = [r.primary_org_id for r in rows if r.primary_org_id]
    if primary_org_ids:
        path_rows = session.execute(
            select(IamOrgClosure.descendant_id, IamOrgNode.name, IamOrgClosure.depth)
            .join(IamOrgNode, IamOrgNode.id == IamOrgClosure.ancestor_id)
            .where(IamOrgClosure.descendant_id.in_(primary_org_ids))
            .order_by(IamOrgClosure.descendant_id, IamOrgClosure.depth.desc())
        ).all()
        grouped: dict[str, list[str]] = {}
        for descendant_id, name, _depth in path_rows:
            grouped.setdefault(str(descendant_id), []).append(name)
        org_paths = {key: " / ".join(names) for key, names in grouped.items()}

    return PaginatedResponse(
        items=[
            {
                "id": row.id,
                "username": row.username,
                "display_name": row.display_name,
                "email": row.email,
                "domain_id": row.domain_id,
                "domain_name": domain_names.get(row.domain_id, ""),
                "department_id": row.department_id,
                "department_name": dept_names.get(row.department_id, ""),
                "team_id": row.team_id,
                "org_path": org_paths.get(row.primary_org_id, "") if row.primary_org_id else "",
                "status": row.status,
                "roles": role_map.get(row.id, []),
            }
            for row in rows
        ],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


class SettingsUpdate(BaseModel):
    challenge_ttl_seconds: int | None = Field(default=None, ge=60, le=900)
    machine_token_ttl_seconds: int | None = Field(default=None, ge=60, le=300)
    heartbeat_offline_seconds: int | None = Field(default=None, ge=30, le=3600)
    directory_sync_ttl_seconds: int | None = Field(default=None, ge=30, le=3600)
    oidc_issuer: str | None = Field(default=None, min_length=1, max_length=500)
    oidc_realm: str | None = Field(default=None, min_length=1, max_length=200)
    oidc_client_id: str | None = Field(default=None, min_length=1, max_length=200)
    iam_sync_client_id: str | None = Field(default=None, min_length=1, max_length=200)
    platform_base_url: str | None = Field(default=None, min_length=1, max_length=500)
    log_level: str | None = Field(default=None, pattern="^(DEBUG|INFO|WARNING|ERROR)$")
    log_dir: str | None = Field(default=None, min_length=1, max_length=500)
    log_max_mb: int | None = Field(default=None, ge=1, le=512)
    log_retention_days: int | None = Field(default=None, ge=1, le=90)
    log_compress: bool | None = Field(default=None)


SETTINGS_KEYS = tuple(SettingsUpdate.model_fields)


def settings_json(request: Request, session: Session) -> dict:
    s = request.app.state.settings
    values = {
        "package_storage_path": str(s.package_storage_path),
        "log_level": s.log_level,
        "log_dir": str(s.log_dir),
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
    for key, value in body.model_dump(exclude_none=True).items():
        item = session.get(PlatformSetting, key)
        if item is None:
            item = PlatformSetting(key=key, value=value, updated_by=identity.principal.id)
            session.add(item)
        else:
            item.value = value
            item.updated_by = identity.principal.id
            item.updated_at = utc_now()
        setattr(request.app.state.settings, key, value)
    if body.log_level:
        apply_log_level(body.log_level)
    if (
        body.log_dir
        or body.log_max_mb is not None
        or body.log_retention_days is not None
        or body.log_compress is not None
    ):
        apply_log_rotation(request.app.state.settings)
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
    logger.info(
        "platform settings updated",
        extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "changed": sorted(body.model_dump(exclude_none=True).keys())},
    )
    return settings_json(request, session)


def audit_scope(session: Session, identity: AuthenticatedPrincipal):
    clauses = []
    for assignment in identity.authorization.assignments:
        if "audit.read" not in ROLE_PERMISSIONS[assignment.role]:
            continue
        scope = assignment.data_scope
        if scope.scope_type is ScopeType.GLOBAL:
            return true()
        if scope.scope_type is ScopeType.ALL_DEPARTMENTS:
            clauses.append(
                or_(
                    AuditEvent.domain_id_snapshot == scope.domain_id,
                    AuditEvent.domain_id_snapshot.is_(None),
                )
            )
        elif scope.scope_type is ScopeType.DEPARTMENT_SET:
            descendant_ids = descendant_org_ids(session, set(scope.department_ids))
            clauses.append(
                or_(
                    (AuditEvent.domain_id_snapshot == scope.domain_id)
                    & AuditEvent.department_id_snapshot.in_(descendant_ids),
                    AuditEvent.domain_id_snapshot.is_(None),
                )
            )
    return or_(*clauses) if clauses else (AuditEvent.id == "")


@router.get("/api/v1/audit-events")
async def audit_events(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
    event_type: str | None = Query(default=None, max_length=80),
    category: str | None = Query(default=None, max_length=20),
    result: str | None = Query(default=None, max_length=20),
    actor_id: str | None = Query(default=None, max_length=100),
    q: str | None = Query(default=None, max_length=200),
    workbench_id: str | None = Query(default=None, max_length=100),
    occurred_from: datetime | None = None,
    occurred_to: datetime | None = None,
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse:
    require_permission(identity, "audit.read")
    statement = select(AuditEvent, IamPrincipal.display_name, IamPrincipal.username).outerjoin(
        IamPrincipal, AuditEvent.actor_id == IamPrincipal.id
    ).where(audit_scope(session, identity))
    if category:
        statement = statement.where(AuditEvent.category == category)
    if event_type:
        statement = statement.where(AuditEvent.event_type == event_type)
    if result:
        statement = statement.where(AuditEvent.result == result)
    if actor_id:
        statement = statement.where(AuditEvent.actor_id == actor_id)
    if q:
        like = f"%{q}%"
        statement = statement.where(
            or_(
                AuditEvent.summary.ilike(like),
                AuditEvent.event_type.ilike(like),
                AuditEvent.actor_id.ilike(like),
                IamPrincipal.username.ilike(like),
                IamPrincipal.display_name.ilike(like),
                AuditEvent.trace_id.ilike(like),
            )
        )
    if workbench_id:
        statement = statement.where(AuditEvent.target_id == workbench_id)
    if occurred_from:
        statement = statement.where(AuditEvent.occurred_at >= occurred_from)
    if occurred_to:
        statement = statement.where(AuditEvent.occurred_at <= occurred_to)
    count_stmt = select(func.count()).select_from(statement.subquery())
    total = session.scalar(count_stmt)
    rows = session.execute(
        statement.order_by(AuditEvent.occurred_at.desc()).offset(offset).limit(limit)
    ).all()
    return PaginatedResponse(
        items=[
            {
                "id": row.id,
                "event_type": row.event_type,
                "category": row.category,
                "actor_type": row.actor_type,
                "actor_id": row.actor_id,
                "actor_display_name": actor_display_name,
                "actor_username": actor_username,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "target_display": f"{row.target_type}:{row.target_id}" if row.target_id else row.target_type,
                "domain_id": row.domain_id_snapshot,
                "department_id": row.department_id_snapshot,
                "result": row.result,
                "reason_code": row.reason_code,
                "summary": row.summary,
                "occurred_at": row.occurred_at,
                "trace_id": row.trace_id,
            }
            for row, actor_display_name, actor_username in rows
        ],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.post("/api/v1/iam/sync")
async def iam_sync(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    # Run synchronously (bypassing the TTL cache) so the UI gets the real reconciliation
    # counts back; ~700 users with batched group membership fetch completes in seconds.
    result = await request.app.state.oidc.sync_directory(session, force=True)
    record_audit(
        session,
        request,
        event_type="IAM_SYNC_TRIGGERED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="IAM",
        target_id=None,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary=(
            f"IAM directory sync: {result['principals_synced']} principals "
            f"({result['principals_disabled']} soft-disabled), {result['org_nodes_synced']} org nodes"
        ),
    )
    session.commit()
    return {"status": "SYNCED", **result}
