from dataclasses import replace

import pytest

from app.domain.authorization import (
    AuthorizationContext,
    DataScope,
    ResourceContext,
    RoleAssignment,
    RoleCode,
    ScopeType,
    is_allowed,
)


def assignment(
    role: RoleCode,
    scope: ScopeType,
    *,
    domain: str | None = None,
    departments: frozenset[str] = frozenset(),
) -> RoleAssignment:
    return RoleAssignment(
        role=role,
        data_scope=DataScope(scope, domain, departments),
    )


@pytest.mark.parametrize(
    ("role", "permission", "expected"),
    [
        (RoleCode.SYSTEM_ADMIN, "role.manage", True),
        (RoleCode.PLATFORM_ADMIN, "package.manage", True),
        (RoleCode.PLATFORM_ADMIN, "role.manage", False),
        (RoleCode.DEPARTMENT_ADMIN, "workbench.read", True),
        (RoleCode.SECURITY_ADMIN, "workbench.revoke", False),
        (RoleCode.AUDIT_ADMIN, "audit.all.read", True),
        (RoleCode.EMPLOYEE, "workbench.enroll", True),
        (RoleCode.EMPLOYEE, "audit.all.read", False),
    ],
)
def test_fixed_role_permissions(role: RoleCode, permission: str, expected: bool) -> None:
    context = AuthorizationContext("principal-1", (assignment(role, ScopeType.GLOBAL),))

    assert is_allowed(context, permission, ResourceContext("domain-a", "dept-a", "principal-1")) is expected


def test_department_set_does_not_cross_domain() -> None:
    context = AuthorizationContext(
        "manager",
        (assignment(RoleCode.DEPARTMENT_ADMIN, ScopeType.DEPARTMENT_SET, domain="domain-a", departments=frozenset({"dept-1", "dept-2"})),),
    )

    assert is_allowed(context, "workbench.read", ResourceContext("domain-a", "dept-2", "employee"))
    assert not is_allowed(context, "workbench.read", ResourceContext("domain-b", "dept-2", "employee"))
    assert not is_allowed(context, "workbench.read", ResourceContext("domain-a", "dept-3", "employee"))


def test_all_departments_includes_future_departments_in_same_domain() -> None:
    context = AuthorizationContext(
        "manager",
        (assignment(RoleCode.AUDIT_ADMIN, ScopeType.ALL_DEPARTMENTS, domain="domain-a"),),
    )

    assert is_allowed(context, "audit.all.read", ResourceContext("domain-a", "new-department", "employee"))
    assert not is_allowed(context, "audit.all.read", ResourceContext("domain-b", "new-department", "employee"))


def test_employee_self_scope_only_matches_owner() -> None:
    context = AuthorizationContext(
        "employee-1",
        (assignment(RoleCode.EMPLOYEE, ScopeType.SELF),),
    )

    own = ResourceContext("domain-a", "dept-a", "employee-1")
    assert is_allowed(context, "workbench.read", own)
    assert not is_allowed(context, "workbench.read", replace(own, owner_principal_id="employee-2"))


def test_multiple_roles_union_permissions_and_scopes() -> None:
    context = AuthorizationContext(
        "manager",
        (
            assignment(RoleCode.DEPARTMENT_ADMIN, ScopeType.DEPARTMENT_SET, domain="domain-a", departments=frozenset({"dept-1"})),
            assignment(RoleCode.SECURITY_ADMIN, ScopeType.DEPARTMENT_SET, domain="domain-a", departments=frozenset({"dept-2"})),
        ),
    )

    assert is_allowed(context, "audit.operation.read", ResourceContext("domain-a", "dept-1", "owner"))
    assert is_allowed(context, "audit.security.read", ResourceContext("domain-a", "dept-2", "owner"))
    assert not is_allowed(context, "audit.security.read", ResourceContext("domain-a", "dept-1", "owner"))
