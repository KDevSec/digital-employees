from dataclasses import dataclass
from enum import StrEnum


class RoleCode(StrEnum):
    SYSTEM_ADMIN = "SYSTEM_ADMIN"
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    DEPARTMENT_ADMIN = "DEPARTMENT_ADMIN"
    SECURITY_ADMIN = "SECURITY_ADMIN"
    AUDIT_ADMIN = "AUDIT_ADMIN"
    EMPLOYEE = "EMPLOYEE"


class ScopeType(StrEnum):
    GLOBAL = "GLOBAL"
    ALL_DEPARTMENTS = "ALL_DEPARTMENTS"
    DEPARTMENT_SET = "DEPARTMENT_SET"
    SELF = "SELF"


@dataclass(frozen=True)
class DataScope:
    scope_type: ScopeType
    domain_id: str | None = None
    department_ids: frozenset[str] = frozenset()


@dataclass(frozen=True)
class RoleAssignment:
    role: RoleCode
    data_scope: DataScope


@dataclass(frozen=True)
class AuthorizationContext:
    principal_id: str
    assignments: tuple[RoleAssignment, ...]
    scoped_grants: tuple = ()


@dataclass(frozen=True)
class ResourceContext:
    domain_id: str
    department_id: str | None
    owner_principal_id: str | None


ROLE_PERMISSIONS: dict[RoleCode, frozenset[str]] = {
    RoleCode.SYSTEM_ADMIN: frozenset(
        {
            "role.manage",
            "platform.settings.manage",
            "feedback.manage",
            "system.logs.read",
            "audit.read",
            "package.manage",
            "workbench.read",
            "workbench.enroll",
            "workbench.enrollment.review",
            "workbench.revoke",
        }
    ),
    RoleCode.PLATFORM_ADMIN: frozenset(
        {
            "platform.settings.manage",
            "feedback.manage",
            "package.manage",
            "workbench.read",
            "workbench.enroll",
            "workbench.enrollment.review",
            "workbench.revoke",
        }
    ),
    RoleCode.DEPARTMENT_ADMIN: frozenset(
        {"workbench.read", "workbench.enroll", "workbench.enrollment.review"}
    ),
    RoleCode.SECURITY_ADMIN: frozenset(
        {"workbench.read", "workbench.enroll"}
    ),
    RoleCode.AUDIT_ADMIN: frozenset(
        {"workbench.read", "workbench.enroll", "audit.read"}
    ),
    RoleCode.EMPLOYEE: frozenset({"workbench.read", "workbench.enroll"}),
}


def scope_contains(scope: DataScope, principal_id: str, resource: ResourceContext) -> bool:
    if scope.scope_type is ScopeType.GLOBAL:
        return True
    if scope.scope_type is ScopeType.SELF:
        return resource.owner_principal_id == principal_id
    if scope.domain_id != resource.domain_id:
        return False
    if scope.scope_type is ScopeType.ALL_DEPARTMENTS:
        return True
    return (
        scope.scope_type is ScopeType.DEPARTMENT_SET
        and resource.department_id is not None
        and resource.department_id in scope.department_ids
    )


def is_allowed(
    context: AuthorizationContext,
    permission: str,
    resource: ResourceContext,
) -> bool:
    return any(
        permission in ROLE_PERMISSIONS[assignment.role]
        and scope_contains(assignment.data_scope, context.principal_id, resource)
        for assignment in context.assignments
    )
