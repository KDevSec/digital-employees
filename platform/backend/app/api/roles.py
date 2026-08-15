from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.audit import record_audit
from app.database import get_session
from app.domain.authorization import RoleCode, ScopeType
from app.errors import ApiError
from app.models import IamDepartment, IamPrincipal, RoleAssignment, RoleAssignmentDepartment


router = APIRouter()


class RoleAssignmentCreate(BaseModel):
    principal_id: str
    role_code: RoleCode
    scope_type: ScopeType
    domain_id: str | None = None
    department_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("domain_id", mode="before")
    @classmethod
    def normalize_optional_domain(cls, value):
        return value or None

    @model_validator(mode="after")
    def validate_scope(self):
        if self.role_code in {RoleCode.SYSTEM_ADMIN, RoleCode.PLATFORM_ADMIN}:
            if self.scope_type is not ScopeType.GLOBAL or self.domain_id or self.department_ids:
                raise ValueError("global administrators require GLOBAL scope")
        elif self.role_code is RoleCode.EMPLOYEE:
            if self.scope_type is not ScopeType.SELF or self.domain_id or self.department_ids:
                raise ValueError("employees require SELF scope")
        elif self.scope_type not in {ScopeType.ALL_DEPARTMENTS, ScopeType.DEPARTMENT_SET} or not self.domain_id:
            raise ValueError("range administrators require a domain scope")
        if self.scope_type is ScopeType.DEPARTMENT_SET and not self.department_ids:
            raise ValueError("DEPARTMENT_SET requires departments")
        return self


def role_json(item: RoleAssignment) -> dict:
    return {
        "id": item.id,
        "principal_id": item.principal_id,
        "role_code": item.role_code,
        "scope_type": item.scope_type,
        "domain_id": item.domain_id,
        "department_ids": [row.department_id for row in item.departments],
        "status": item.status,
        "created_at": item.created_at,
    }


@router.get("/api/v1/role-assignments")
async def list_role_assignments(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "role.manage")
    rows = session.scalars(select(RoleAssignment).where(RoleAssignment.status == "ACTIVE")).all()
    return [role_json(row) for row in rows]


@router.post("/api/v1/role-assignments", status_code=status.HTTP_201_CREATED)
async def create_role_assignment(
    body: RoleAssignmentCreate,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, body.principal_id)
    if principal is None or principal.status != "ACTIVE":
        raise ApiError(404, "PRINCIPAL_NOT_FOUND", "Active principal not found")
    if body.domain_id and body.domain_id != principal.domain_id and body.role_code is RoleCode.EMPLOYEE:
        raise ApiError(422, "ROLE_SCOPE_INVALID", "Role scope does not match principal domain")
    if body.department_ids:
        departments = session.scalars(
            select(IamDepartment).where(IamDepartment.id.in_(body.department_ids))
        ).all()
        if len(departments) != len(set(body.department_ids)) or any(d.domain_id != body.domain_id for d in departments):
            raise ApiError(422, "ROLE_SCOPE_INVALID", "Departments must exist in the selected domain")
    duplicate = session.scalar(
        select(RoleAssignment).where(
            RoleAssignment.principal_id == body.principal_id,
            RoleAssignment.role_code == body.role_code,
            RoleAssignment.scope_type == body.scope_type,
            RoleAssignment.domain_id == body.domain_id,
            RoleAssignment.status == "ACTIVE",
        )
    )
    if duplicate:
        raise ApiError(409, "ROLE_ASSIGNMENT_EXISTS", "An equivalent active assignment already exists")
    item = RoleAssignment(
        id=str(uuid4()),
        principal_id=body.principal_id,
        role_code=body.role_code,
        scope_type=body.scope_type,
        domain_id=body.domain_id,
        status="ACTIVE",
        created_by=identity.principal.id,
        departments=[RoleAssignmentDepartment(department_id=value) for value in sorted(set(body.department_ids))],
    )
    session.add(item)
    record_audit(
        session,
        request,
        event_type="ROLE_ASSIGNED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="ROLE_ASSIGNMENT",
        target_id=item.id,
        domain_id=principal.domain_id,
        department_id=principal.department_id,
        summary=f"Assigned fixed role {body.role_code}",
    )
    session.commit()
    return role_json(item)


@router.delete("/api/v1/role-assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_role_assignment(
    assignment_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> Response:
    require_permission(identity, "role.manage")
    item = session.get(RoleAssignment, assignment_id)
    if item is None or item.status != "ACTIVE":
        raise ApiError(404, "ROLE_ASSIGNMENT_NOT_FOUND", "Active role assignment not found")
    if item.role_code == RoleCode.SYSTEM_ADMIN:
        remaining = session.scalar(
            select(func.count()).select_from(RoleAssignment).where(
                RoleAssignment.role_code == RoleCode.SYSTEM_ADMIN,
                RoleAssignment.status == "ACTIVE",
                RoleAssignment.id != item.id,
            )
        )
        if remaining == 0:
            raise ApiError(409, "LAST_SYSTEM_ADMIN", "The last active system administrator cannot be revoked")
    item.status = "REVOKED"
    item.revoked_by = identity.principal.id
    item.revoked_at = datetime.now(UTC)
    target = session.get(IamPrincipal, item.principal_id)
    record_audit(
        session,
        request,
        event_type="ROLE_REVOKED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="ROLE_ASSIGNMENT",
        target_id=item.id,
        domain_id=target.domain_id if target else None,
        department_id=target.department_id if target else None,
        summary=f"Revoked fixed role {item.role_code}",
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
