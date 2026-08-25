import uuid
from httpx import AsyncClient

from app.models import IamPrincipal, RoleAssignment
from app.domain.authorization import RoleCode, ScopeType


async def test_principal_authorizations_returns_only_that_user(
    client: AsyncClient, system_headers, db_factory
):
    with db_factory() as session:
        session.add(IamPrincipal(
            id="auth-test-user", issuer="https://iam.test/realms/digital",
            subject="sub-auth-test", username="authtest", display_name="Auth Test",
            domain_id="domain-a", department_id="dept-a", status="ACTIVE",
        ))
        session.add(RoleAssignment(
            id="ra-auth-test", principal_id="auth-test-user",
            role_code=RoleCode.DEPARTMENT_ADMIN, scope_type=ScopeType.ALL_DEPARTMENTS,
            domain_id="domain-a", status="ACTIVE", created_by="bootstrap",
        ))
        session.commit()

    resp = await client.get("/api/v1/principals/auth-test-user/authorizations", headers=system_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert any(a["role_code"] == "DEPARTMENT_ADMIN" for a in data["fixed_assignments"])
    # Should not include other users' assignments
    other_fixed = [a for a in data["fixed_assignments"] if a["principal_id"] != "auth-test-user"]
    assert len(other_fixed) == 0


async def test_scope_options_excludes_assignments(client: AsyncClient, system_headers):
    resp = await client.get("/api/v1/authorization/scope-options", headers=system_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "domains" in data
    assert "org_nodes" in data
    assert "custom_roles" in data
    # Must NOT return full assignment dumps
    assert "fixed_assignments" not in data
    assert "scoped_grants" not in data
    assert "principals" not in data


async def test_principals_filter_by_status(client: AsyncClient, system_headers, db_factory):
    with db_factory() as session:
        session.add(IamPrincipal(
            id="disabled-user", issuer="https://iam.test/realms/digital",
            subject="sub-disabled", username="disabled", display_name="Disabled User",
            domain_id="domain-a", department_id="dept-a", status="DISABLED",
        ))
        session.commit()

    resp = await client.get("/api/v1/iam/principals?status=DISABLED", headers=system_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["status"] == "DISABLED" for i in items)
    assert any(i["username"] == "disabled" for i in items)


async def test_principals_filter_by_role(client: AsyncClient, system_headers):
    resp = await client.get("/api/v1/iam/principals?role_code=SYSTEM_ADMIN", headers=system_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all("SYSTEM_ADMIN" in i["roles"] for i in items)
