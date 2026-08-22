import time
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.database import get_session
from app.domain.authorization import ROLE_PERMISSIONS, RoleCode
from app.domain.scoped_authorization import is_scoped_allowed
from app.errors import ApiError
from app.models import (
    CustomRole,
    CustomRolePermission,
    IamDomain,
    IamOrgNode,
    IamPrincipal,
    IamPrincipalOrg,
    PermissionDefinition,
    RoleAssignment,
    ScopedRoleAssignment,
)


router = APIRouter()


@router.get("/api/v1/me/effective-permissions")
async def effective_permissions(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
) -> dict:
    fixed_sources = [
        {
            "source_type": "FIXED_ROLE",
            "role": assignment.role.value,
            "permissions": sorted(ROLE_PERMISSIONS[assignment.role]),
            "scope": {
                "type": assignment.data_scope.scope_type.value,
                "domain_id": assignment.data_scope.domain_id,
                "department_ids": sorted(assignment.data_scope.department_ids),
            },
        }
        for assignment in identity.authorization.assignments
    ]
    scoped_sources = [
        {
            "source_type": "SCOPED_ROLE",
            "role_id": grant.role_id,
            "assignment_id": grant.assignment_id,
            "permissions": sorted(grant.permissions),
            "scope": {
                "org_id": grant.scope_org_id,
                "include_descendants": grant.scope_include_descendants,
            },
        }
        for grant in identity.authorization.scoped_grants
    ]
    permissions = {
        permission
        for source in [*fixed_sources, *scoped_sources]
        for permission in source["permissions"]
    }
    return {
        "principal_id": identity.principal.id,
        "permissions": sorted(permissions),
        "sources": [*fixed_sources, *scoped_sources],
    }


def _has_permission(
    session: Session,
    identity: AuthenticatedPrincipal,
    permission: str,
    org_id: str | None = None,
) -> bool:
    if _is_privileged_admin(identity):
        return True
    if org_id is None:
        return any(permission in grant.permissions for grant in identity.authorization.scoped_grants)
    return is_scoped_allowed(
        session, identity.authorization.scoped_grants, permission, org_id
    )


def _is_privileged_admin(identity: AuthenticatedPrincipal) -> bool:
    return any(
        "role.manage" in ROLE_PERMISSIONS[assignment.role]
        for assignment in identity.authorization.assignments
    )


def _validate_delegated_role_permissions(
    session: Session,
    identity: AuthenticatedPrincipal,
    domain_id: str,
    permission_codes: list[str],
) -> None:
    if _is_privileged_admin(identity):
        return
    definitions = session.scalars(
        select(PermissionDefinition).where(PermissionDefinition.code.in_(permission_codes))
    ).all()
    definition_by_code = {definition.code: definition for definition in definitions}
    if len(definition_by_code) != len(permission_codes):
        raise ApiError(422, "PERMISSION_NOT_FOUND", "Every permission must be system-defined")
    actor_domains = {
        node.domain_id
        for node in (
            session.get(IamOrgNode, grant.scope_org_id)
            for grant in identity.authorization.scoped_grants
            if "role.assign" in grant.permissions
        )
        if node is not None
    }
    if domain_id not in actor_domains:
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    for code in permission_codes:
        definition = definition_by_code[code]
        if not definition.delegable or not _has_permission(session, identity, code):
            raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")


def _validate_delegated_subject(
    session: Session,
    identity: AuthenticatedPrincipal,
    subject_type: str,
    subject_id: str,
) -> None:
    if _is_privileged_admin(identity):
        return
    if subject_type == "PRINCIPAL":
        if subject_id == identity.principal.id:
            raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
        subject = session.get(IamPrincipal, subject_id)
        managed = subject is not None and subject.primary_org_id is not None and is_scoped_allowed(
            session, identity.authorization.scoped_grants, "role.assign", subject.primary_org_id
        )
        if not managed and subject is not None:
            memberships = session.scalars(
                select(IamPrincipalOrg).where(
                    IamPrincipalOrg.principal_id == subject.id,
                    IamPrincipalOrg.status == "ACTIVE",
                )
            ).all()
            managed = any(
                is_scoped_allowed(
                    session, identity.authorization.scoped_grants, "role.assign", membership.org_id
                )
                for membership in memberships
            )
        if not managed:
            raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
        return
    if not is_scoped_allowed(session, identity.authorization.scoped_grants, "role.assign", subject_id):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")


class CustomRoleCreate(BaseModel):
    domain_id: str
    code: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    permission_codes: list[str] = Field(min_length=1, max_length=100)

    @field_validator("permission_codes")
    @classmethod
    def unique_permissions(cls, value: list[str]) -> list[str]:
        return sorted(set(value))


class CustomRoleUpdate(BaseModel):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    permission_codes: list[str] | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("permission_codes")
    @classmethod
    def unique_permissions(cls, value: list[str] | None) -> list[str] | None:
        return sorted(set(value)) if value is not None else None


class RoleGrantCreate(BaseModel):
    role_id: str
    subject_type: str
    subject_id: str
    subject_include_descendants: bool = False
    scope_org_id: str
    scope_include_descendants: bool = False

    @field_validator("subject_type")
    @classmethod
    def valid_subject_type(cls, value: str) -> str:
        if value not in {"PRINCIPAL", "ORGANIZATION"}:
            raise ValueError("subject_type must be PRINCIPAL or ORGANIZATION")
        return value


def role_json(role: CustomRole, permission_codes: list[str]) -> dict:
    return {
        "id": role.id,
        "domain_id": role.domain_id,
        "code": role.code,
        "name": role.name,
        "description": role.description,
        "permission_codes": permission_codes,
        "status": role.status,
        "version": role.version,
    }


def grant_json(grant: ScopedRoleAssignment) -> dict:
    return {
        "id": grant.id,
        "role_id": grant.role_id,
        "subject_type": grant.subject_type,
        "subject_id": grant.subject_id,
        "subject_include_descendants": grant.subject_include_descendants,
        "scope_org_id": grant.scope_org_id,
        "scope_include_descendants": grant.scope_include_descendants,
        "status": grant.status,
        "valid_from": grant.valid_from,
        "valid_until": grant.valid_until,
        "version": grant.version,
    }


@router.get("/api/v1/permissions")
async def list_permission_definitions(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "role.manage")
    rows = session.scalars(
        select(PermissionDefinition)
        .where(PermissionDefinition.status == "ACTIVE")
        .order_by(PermissionDefinition.resource_type, PermissionDefinition.code)
    ).all()
    return [
        {
            "code": row.code,
            "resource_type": row.resource_type,
            "action": row.action,
            "description": row.description,
            "risk_level": row.risk_level,
            "delegable": row.delegable,
        }
        for row in rows
    ]


@router.post("/api/v1/roles", status_code=status.HTTP_201_CREATED)
async def create_custom_role(
    body: CustomRoleCreate,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    if not _has_permission(session, identity, "role.assign"):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    permissions = session.scalars(
        select(PermissionDefinition).where(
            PermissionDefinition.code.in_(body.permission_codes),
            PermissionDefinition.status == "ACTIVE",
        )
    ).all()
    if len(permissions) != len(body.permission_codes):
        raise ApiError(422, "PERMISSION_NOT_FOUND", "Every permission must be active and system-defined")
    _validate_delegated_role_permissions(session, identity, body.domain_id, body.permission_codes)
    duplicate = session.scalar(
        select(CustomRole).where(CustomRole.domain_id == body.domain_id, CustomRole.code == body.code)
    )
    if duplicate:
        raise ApiError(409, "ROLE_EXISTS", "Role code already exists in this domain")
    role = CustomRole(
        id=str(uuid4()),
        domain_id=body.domain_id,
        code=body.code,
        name=body.name,
        description=body.description,
        created_by=identity.principal.id,
    )
    session.add(role)
    session.flush()
    session.add_all(
        CustomRolePermission(role_id=role.id, permission_code=code) for code in body.permission_codes
    )
    session.commit()
    return role_json(role, body.permission_codes)


@router.patch("/api/v1/roles/{role_id}")
async def update_custom_role(
    role_id: str,
    body: CustomRoleUpdate,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    if not _has_permission(session, identity, "role.assign"):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    role = session.get(CustomRole, role_id)
    if role is None or role.status != "ACTIVE":
        raise ApiError(404, "ROLE_NOT_FOUND", "Active role not found")
    if role.version != body.version:
        raise ApiError(409, "VERSION_CONFLICT", "Role was changed by another administrator")
    if body.permission_codes is not None:
        permissions = session.scalars(
            select(PermissionDefinition).where(
                PermissionDefinition.code.in_(body.permission_codes),
                PermissionDefinition.status == "ACTIVE",
            )
        ).all()
        if len(permissions) != len(body.permission_codes):
            raise ApiError(422, "PERMISSION_NOT_FOUND", "Every permission must be active and system-defined")
        _validate_delegated_role_permissions(session, identity, role.domain_id, body.permission_codes)
        session.execute(delete(CustomRolePermission).where(CustomRolePermission.role_id == role.id))
        session.add_all(
            CustomRolePermission(role_id=role.id, permission_code=code)
            for code in body.permission_codes
        )
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    role.version += 1
    from app.audit import record_audit

    record_audit(
        session,
        request,
        event_type="CUSTOM_ROLE_UPDATED",
        category="AUTHORIZATION",
        actor_type="PRINCIPAL",
        actor_id=identity.principal.id,
        target_type="CUSTOM_ROLE",
        target_id=role.id,
        domain_id=role.domain_id,
        department_id=None,
        summary=f"Updated custom role {role.code}",
    )
    session.commit()
    codes = list(
        session.scalars(
            select(CustomRolePermission.permission_code).where(CustomRolePermission.role_id == role.id)
        ).all()
    )
    return role_json(role, codes)


@router.get("/api/v1/roles")
async def list_custom_roles(
    domain_id: str | None = None,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "role.manage")
    statement = select(CustomRole).where(CustomRole.status == "ACTIVE")
    if domain_id:
        statement = statement.where(CustomRole.domain_id == domain_id)
    result = []
    for role in session.scalars(statement.order_by(CustomRole.name)).all():
        codes = list(
            session.scalars(
                select(CustomRolePermission.permission_code).where(CustomRolePermission.role_id == role.id)
            ).all()
        )
        result.append(role_json(role, codes))
    return result


@router.post("/api/v1/role-grants", status_code=status.HTTP_201_CREATED)
async def create_role_grant(
    body: RoleGrantCreate,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    del idempotency_key
    if not _has_permission(session, identity, "role.assign"):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    role = session.get(CustomRole, body.role_id)
    scope = session.get(IamOrgNode, body.scope_org_id)
    if role is None or role.status != "ACTIVE" or scope is None or scope.status != "ACTIVE":
        raise ApiError(404, "ROLE_OR_SCOPE_NOT_FOUND", "Active role and scope are required")
    if role.domain_id != scope.domain_id:
        raise ApiError(422, "ROLE_SCOPE_DOMAIN_MISMATCH", "Role and scope must share a domain")
    if body.subject_type == "PRINCIPAL":
        subject = session.get(IamPrincipal, body.subject_id)
        subject_domain = subject.domain_id if subject else None
    else:
        subject = session.get(IamOrgNode, body.subject_id)
        subject_domain = subject.domain_id if subject else None
    if subject is None or subject_domain != role.domain_id:
        raise ApiError(422, "ROLE_SUBJECT_INVALID", "Subject must exist in the role domain")
    _validate_delegated_subject(session, identity, body.subject_type, body.subject_id)
    role_permissions = list(
        session.scalars(
            select(CustomRolePermission.permission_code).where(
                CustomRolePermission.role_id == role.id
            )
        ).all()
    )
    for permission in role_permissions:
        if not _has_permission(session, identity, permission, scope.id):
            raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    if not _has_permission(session, identity, "role.assign", scope.id):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    duplicate = session.scalar(
        select(ScopedRoleAssignment).where(
            ScopedRoleAssignment.role_id == role.id,
            ScopedRoleAssignment.subject_type == body.subject_type,
            ScopedRoleAssignment.subject_id == body.subject_id,
            ScopedRoleAssignment.scope_org_id == scope.id,
            ScopedRoleAssignment.status == "ACTIVE",
        )
    )
    if duplicate:
        return grant_json(duplicate)
    grant = ScopedRoleAssignment(
        id=str(uuid4()),
        role_id=role.id,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        subject_include_descendants=body.subject_include_descendants,
        scope_org_id=scope.id,
        scope_include_descendants=body.scope_include_descendants,
        created_by=identity.principal.id,
    )
    session.add(grant)
    session.commit()
    return grant_json(grant)


@router.get("/api/v1/role-grants")
async def list_role_grants(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "role.manage")
    return [
        grant_json(row)
        for row in session.scalars(
            select(ScopedRoleAssignment).where(ScopedRoleAssignment.status == "ACTIVE")
        ).all()
    ]


@router.delete("/api/v1/role-grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_role_grant(
    grant_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> None:
    if not _has_permission(session, identity, "role.assign"):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    grant = session.get(ScopedRoleAssignment, grant_id)
    if grant is None:
        return
    if grant.status == "ACTIVE" and not _has_permission(
        session, identity, "role.assign", grant.scope_org_id
    ):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    if grant.status == "ACTIVE":
        grant.status = "REVOKED"
        grant.revoked_by = identity.principal.id
        grant.revoked_at = datetime.now(UTC)
        grant.version += 1
        from app.audit import record_audit

        record_audit(
            session,
            request,
            event_type="ROLE_GRANT_REVOKED",
            category="AUTHORIZATION",
            actor_type="PRINCIPAL",
            actor_id=identity.principal.id,
            target_type="ROLE_GRANT",
            target_id=grant.id,
            domain_id=None,
            department_id=None,
            summary=f"Revoked role grant {grant.id}",
        )
        session.commit()


_SCOPE_OPTIONS_TTL = 60.0
_scope_options_cache: tuple[float, dict] | None = None


@router.get("/api/v1/authorization/scope-options")
async def authorization_scope_options(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    global _scope_options_cache
    require_permission(identity, "role.manage")
    now = time.monotonic()
    if _scope_options_cache is not None and _scope_options_cache[0] > now:
        return _scope_options_cache[1]
    domains = [
        {"id": d.id, "name": d.name}
        for d in session.scalars(select(IamDomain).order_by(IamDomain.name)).all()
    ]
    org_nodes = [
        {"id": n.id, "name": n.name, "domain_id": n.domain_id, "parent_id": n.parent_id, "org_type": n.org_type}
        for n in session.scalars(
            select(IamOrgNode).where(IamOrgNode.status == "ACTIVE").order_by(IamOrgNode.name)
        ).all()
    ]
    custom_roles = [
        {"id": r.id, "name": r.name, "code": r.code}
        for r in session.scalars(
            select(CustomRole).where(CustomRole.status == "ACTIVE").order_by(CustomRole.name)
        ).all()
    ]
    payload = {"domains": domains, "org_nodes": org_nodes, "custom_roles": custom_roles}
    _scope_options_cache = (now + _SCOPE_OPTIONS_TTL, payload)
    return payload
