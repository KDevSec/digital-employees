"""RED tests for 016-department-admin-scope-fix.

Covers: DOMAIN node rejected, TEAM node accepted, DEPARTMENT_SET upsert,
IntegrityError structured response.
"""
from httpx import AsyncClient

from app.domain.authorization import RoleCode, ScopeType
from app.models import IamOrgClosure, IamOrgNode, IamPrincipal, RoleAssignment


def seed_org_tree(db_factory) -> None:
    with db_factory() as session:
        session.add_all([
            IamOrgNode(id="org-dept-a", keycloak_group_id="kc-dept-a", domain_id="domain-a",
                       parent_id="domain-a", org_code="dept-a", org_type="DEPARTMENT", name="研发部"),
            IamOrgNode(id="org-team-a", keycloak_group_id="kc-team-a", domain_id="domain-a",
                       parent_id="org-dept-a", org_code="team-a", org_type="TEAM", name="前端组"),
            IamOrgClosure(ancestor_id="domain-a", descendant_id="org-dept-a", depth=1),
            IamOrgClosure(ancestor_id="org-dept-a", descendant_id="org-dept-a", depth=0),
            IamOrgClosure(ancestor_id="domain-a", descendant_id="org-team-a", depth=2),
            IamOrgClosure(ancestor_id="org-dept-a", descendant_id="org-team-a", depth=1),
            IamOrgClosure(ancestor_id="org-team-a", descendant_id="org-team-a", depth=0),
        ])
        session.commit()


def assign_body(department_ids: list[str]) -> dict:
    return {
        "principal_id": "employee-user",
        "role_code": "DEPARTMENT_ADMIN",
        "scope_type": "DEPARTMENT_SET",
        "domain_id": "domain-a",
        "department_ids": department_ids,
    }


async def test_assign_rejects_domain_node(client: AsyncClient, system_headers, db_factory):
    seed_org_tree(db_factory)
    resp = await client.post("/api/v1/role-assignments", headers=system_headers,
                             json=assign_body(["domain-a"]))
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "ROLE_SCOPE_INVALID"


async def test_assign_accepts_team_node(client: AsyncClient, system_headers, db_factory):
    seed_org_tree(db_factory)
    resp = await client.post("/api/v1/role-assignments", headers=system_headers,
                             json=assign_body(["org-team-a"]))
    assert resp.status_code in (200, 201), resp.text
    data = resp.json()
    assert "org-team-a" in data["department_ids"]


async def test_assign_creates_when_absent(client: AsyncClient, system_headers, db_factory):
    seed_org_tree(db_factory)
    resp = await client.post("/api/v1/role-assignments", headers=system_headers,
                             json=assign_body(["org-dept-a"]))
    assert resp.status_code in (200, 201), resp.text
    with db_factory() as session:
        rows = session.scalars(
            RoleAssignment.__table__.select().where(
                RoleAssignment.principal_id == "employee-user",
                RoleAssignment.role_code == RoleCode.DEPARTMENT_ADMIN,
                RoleAssignment.status == "ACTIVE",
            )
        ).all()
        assert len(rows) == 1


async def test_assign_upsert_replaces_departments(client: AsyncClient, system_headers, db_factory):
    seed_org_tree(db_factory)
    first = await client.post("/api/v1/role-assignments", headers=system_headers,
                              json=assign_body(["org-dept-a"]))
    assert first.status_code in (200, 201), first.text
    first_id = first.json()["id"]
    second = await client.post("/api/v1/role-assignments", headers=system_headers,
                               json=assign_body(["org-dept-a", "org-team-a"]))
    assert second.status_code in (200, 201), second.text
    with db_factory() as session:
        rows = session.query(RoleAssignment).filter_by(
            principal_id="employee-user", role_code=RoleCode.DEPARTMENT_ADMIN,
            scope_type=ScopeType.DEPARTMENT_SET, domain_id="domain-a", status="ACTIVE",
        ).all()
        assert len(rows) == 1, "upsert must not create a duplicate assignment"
        assert rows[0].id == first_id, "upsert must update the same row"
        dept_ids = sorted(d.department_id for d in rows[0].departments)
        assert dept_ids == ["org-dept-a", "org-team-a"]


async def test_assign_idempotent_same_set(client: AsyncClient, system_headers, db_factory):
    seed_org_tree(db_factory)
    await client.post("/api/v1/role-assignments", headers=system_headers,
                      json=assign_body(["org-dept-a"]))
    again = await client.post("/api/v1/role-assignments", headers=system_headers,
                             json=assign_body(["org-dept-a"]))
    assert again.status_code in (200, 201), again.text
    with db_factory() as session:
        rows = session.query(RoleAssignment).filter_by(
            principal_id="employee-user", role_code=RoleCode.DEPARTMENT_ADMIN,
            scope_type=ScopeType.DEPARTMENT_SET, domain_id="domain-a", status="ACTIVE",
        ).all()
        assert len(rows) == 1


async def test_integrity_error_returns_structured(client: AsyncClient, system_headers, db_factory, monkeypatch):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    with db_factory() as session:
        session.add(IamPrincipal(
            id="fresh-user", issuer="https://iam.test/realms/digital", subject="sub-fresh",
            username="fresh", display_name="Fresh", domain_id="domain-a", status="ACTIVE",
        ))
        session.commit()

    def fake_commit(self):
        raise IntegrityError("INSERT ...", {}, Exception("simulated fk violation"))

    monkeypatch.setattr(Session, "commit", fake_commit)
    resp = await client.post("/api/v1/role-assignments", headers=system_headers, json={
        "principal_id": "fresh-user", "role_code": "EMPLOYEE",
        "scope_type": "SELF", "domain_id": None, "department_ids": [],
    })
    assert resp.status_code == 500, resp.text
    assert resp.json()["error"]["code"] == "DB_INTEGRITY_ERROR"
