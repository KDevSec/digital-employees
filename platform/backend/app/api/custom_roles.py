from uuid import uuid4

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.database import get_session
from app.errors import ApiError
from app.models import (
    CustomRole,
    CustomRolePermission,
    IamOrgNode,
    IamPrincipal,
    PermissionDefinition,
    ScopedRoleAssignment,
)


router = APIRouter()


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
    require_permission(identity, "role.manage")
    permissions = session.scalars(
        select(PermissionDefinition).where(
            PermissionDefinition.code.in_(body.permission_codes),
            PermissionDefinition.status == "ACTIVE",
        )
    ).all()
    if len(permissions) != len(body.permission_codes):
        raise ApiError(422, "PERMISSION_NOT_FOUND", "Every permission must be active and system-defined")
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
    require_permission(identity, "role.manage")
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
