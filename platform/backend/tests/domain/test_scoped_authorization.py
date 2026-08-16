from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base


def test_organization_role_applies_to_descendant_members_and_resources_only() -> None:
    from app.domain.scoped_authorization import is_scoped_allowed, load_effective_grants
    from app.models import (
        CustomRole,
        CustomRolePermission,
        IamOrgClosure,
        IamOrgNode,
        IamPrincipal,
        IamPrincipalOrg,
        PermissionDefinition,
        ScopedRoleAssignment,
    )

    engine = create_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        nodes = [
            IamOrgNode(id="iei", keycloak_group_id="kc-iei", domain_id="iei", org_code="iei", org_type="DOMAIN", name="IEI"),
            IamOrgNode(id="cbb", keycloak_group_id="kc-cbb", domain_id="iei", parent_id="iei", org_code="cbb", org_type="TEAM", name="CBB"),
            IamOrgNode(id="security", keycloak_group_id="kc-security", domain_id="iei", parent_id="cbb", org_code="security", org_type="GROUP", name="Security"),
            IamOrgNode(id="kos", keycloak_group_id="kc-kos", domain_id="iei", parent_id="iei", org_code="kos", org_type="TEAM", name="KOS"),
        ]
        session.add_all(nodes)
        session.flush()
        session.add_all(
            [
                IamOrgClosure(ancestor_id="iei", descendant_id="iei", depth=0),
                IamOrgClosure(ancestor_id="iei", descendant_id="cbb", depth=1),
                IamOrgClosure(ancestor_id="iei", descendant_id="security", depth=2),
                IamOrgClosure(ancestor_id="cbb", descendant_id="cbb", depth=0),
                IamOrgClosure(ancestor_id="cbb", descendant_id="security", depth=1),
                IamOrgClosure(ancestor_id="security", descendant_id="security", depth=0),
                IamOrgClosure(ancestor_id="iei", descendant_id="kos", depth=1),
                IamOrgClosure(ancestor_id="kos", descendant_id="kos", depth=0),
                IamPrincipal(id="p1", issuer="issuer", subject="p1", username="fanyi", display_name="fanyi", domain_id="iei", primary_org_id="security", status="ACTIVE"),
                IamPrincipalOrg(principal_id="p1", org_id="security", membership_type="PRIMARY"),
                PermissionDefinition(code="organization.member.manage", resource_type="organization", action="manage", description="Manage members", risk_level="HIGH", delegable=True),
                CustomRole(id="r1", domain_id="iei", code="cbb-admin", name="CBB管理员", status="ACTIVE", created_by="system"),
                CustomRolePermission(role_id="r1", permission_code="organization.member.manage"),
                ScopedRoleAssignment(id="a1", role_id="r1", subject_type="ORGANIZATION", subject_id="cbb", subject_include_descendants=True, scope_org_id="cbb", scope_include_descendants=True, status="ACTIVE", created_by="system"),
            ]
        )
        session.commit()

        grants = load_effective_grants(session, "p1", now=datetime.now(UTC))

        assert is_scoped_allowed(session, grants, "organization.member.manage", "security")
        assert not is_scoped_allowed(session, grants, "organization.member.manage", "kos")


def test_expired_assignment_does_not_grant_permission() -> None:
    from app.domain.scoped_authorization import is_scoped_allowed, load_effective_grants
    from app.models import CustomRole, CustomRolePermission, IamOrgClosure, IamOrgNode, IamPrincipal, PermissionDefinition, ScopedRoleAssignment

    engine = create_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    now = datetime.now(UTC)
    with Session(engine) as session:
        session.add_all(
            [
                IamOrgNode(id="iei", keycloak_group_id="kc-iei", domain_id="iei", org_code="iei", org_type="DOMAIN", name="IEI"),
                IamOrgClosure(ancestor_id="iei", descendant_id="iei", depth=0),
                IamPrincipal(id="p1", issuer="issuer", subject="p1", username="fanyi", display_name="fanyi", domain_id="iei", status="ACTIVE"),
                PermissionDefinition(code="organization.read", resource_type="organization", action="read", description="Read", risk_level="LOW", delegable=True),
                CustomRole(id="r1", domain_id="iei", code="reader", name="Reader", status="ACTIVE", created_by="system"),
                CustomRolePermission(role_id="r1", permission_code="organization.read"),
                ScopedRoleAssignment(id="a1", role_id="r1", subject_type="PRINCIPAL", subject_id="p1", subject_include_descendants=False, scope_org_id="iei", scope_include_descendants=True, status="ACTIVE", valid_until=now - timedelta(seconds=1), created_by="system"),
            ]
        )
        session.commit()

        grants = load_effective_grants(session, "p1", now=now)

        assert not is_scoped_allowed(session, grants, "organization.read", "iei")
