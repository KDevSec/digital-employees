import uuid

from httpx import AsyncClient

from app.domain.crypto import create_es256_key_pair
from app.models import (
    CustomRole,
    CustomRolePermission,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    RoleAssignment,
    ScopedRoleAssignment,
    WorkbenchInstance,
)
from app.domain.authorization import RoleCode, ScopeType


def _org(session, node_id: str, parent: str | None, name: str, domain: str = "domain-a") -> str:
    session.add(IamOrgNode(
        id=node_id, keycloak_group_id=f"kc-{node_id}", domain_id=domain, parent_id=parent,
        org_code=node_id, org_type="ORG_UNIT", name=name,
    ))
    session.flush()
    session.add(IamOrgClosure(ancestor_id=node_id, descendant_id=node_id, depth=0))
    if parent:
        for edge in session.query(IamOrgClosure).filter_by(descendant_id=parent).all():
            session.add(IamOrgClosure(ancestor_id=edge.ancestor_id, descendant_id=node_id, depth=edge.depth + 1))
    return node_id


def _scoped_reviewer(session, scope_org: str):
    role = CustomRole(id="reviewer-role", domain_id="domain-a", code="reviewer", name="Reviewer", created_by="system")
    session.add(role)
    session.add(CustomRolePermission(role_id=role.id, permission_code="workbench.enrollment.review"))
    session.add(CustomRolePermission(role_id=role.id, permission_code="workbench.read"))
    session.add(ScopedRoleAssignment(
        id="reviewer-grant", role_id=role.id, subject_type="PRINCIPAL", subject_id="dept-admin-user",
        subject_include_descendants=False, scope_org_id=scope_org, scope_include_descendants=True,
        status="ACTIVE", created_by="system",
    ))


async def _set_primary_org(db_factory, principal_id: str, org_id: str):
    with db_factory() as session:
        session.get(IamPrincipal, principal_id).primary_org_id = org_id
        session.commit()


async def _submit(client: AsyncClient, headers, db_factory, principal_id: str, primary_org: str, name: str):
    await _set_primary_org(db_factory, principal_id, primary_org)
    _, public_jwk = create_es256_key_pair()
    resp = await client.post(
        "/api/v1/workbench-enrollments", headers=headers,
        json={"installation_id": str(uuid.uuid4()), "public_key": public_jwk,
              "display_name": name, "workbench_version": "0.1.0", "os": "linux", "arch": "x64"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_dept_admin_sees_and_approves_only_scoped_enrollments(
    client: AsyncClient, employee_headers, dept_admin_headers, db_factory
):
    with db_factory() as session:
        _org(session, "cbb", "domain-a", "存储研发部")
        _org(session, "security", "cbb", "基础处")
        _org(session, "team-sec", "security", "安全团队")
        _org(session, "kos", "domain-a", "KOS 部")
        session.add(IamPrincipal(
            id="kos-user", issuer="https://iam.test/realms/digital", subject="sub-kos",
            username="kosuser", display_name="KOS User", domain_id="domain-a", status="ACTIVE",
        ))
        _scoped_reviewer(session, "cbb")
        session.commit()

    in_scope = await _submit(client, employee_headers, db_factory, "employee-user", "team-sec", "In Scope WB")

    # out-of-scope enrollment owned by kos-user
    out_scope = await _submit(client, employee_headers, db_factory, "employee-user", "kos", "Out Scope WB")
    with db_factory() as session:
        from app.models import EnrollmentRequest
        e = session.get(EnrollmentRequest, out_scope["id"])
        e.owner_principal_id = "kos-user"
        e.owner_primary_org_id = "kos"
        session.commit()

    listed = await client.get("/api/v1/workbench-enrollments", headers=dept_admin_headers)
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    ids = {item["id"] for item in items}
    assert in_scope["id"] in ids
    assert out_scope["id"] not in ids
    detail = items[0]
    assert detail["owner_display_name"] == "Employee"
    assert detail["org_path"] == "Example Corp-存储研发部-基础处-安全团队"

    approve = await client.post(f"/api/v1/workbench-enrollments/{in_scope['id']}/approve", headers=dept_admin_headers)
    assert approve.status_code == 200, approve.text

    out_approve = await client.post(f"/api/v1/workbench-enrollments/{out_scope['id']}/approve", headers=dept_admin_headers)
    assert out_approve.status_code == 403


async def test_workbench_list_supports_org_and_person_search(
    client: AsyncClient, dept_admin_headers, db_factory
):
    with db_factory() as session:
        _org(session, "cbb2", "domain-a", "CBB2")
        _org(session, "team2", "cbb2", "Team2")
        _org(session, "kos2", "domain-a", "KOS2")
        _scoped_reviewer(session, "cbb2")
        session.get(IamPrincipal, "employee-user").primary_org_id = "team2"
        session.add(IamPrincipal(
            id="kos-user2", issuer="https://iam.test/realms/digital", subject="sub-kos2",
            username="kosuser2", display_name="KOS User2", domain_id="domain-a",
            primary_org_id="kos2", status="ACTIVE",
        ))
        session.add(WorkbenchInstance(
            id="wb-in-scope", enrollment_request_id="er1", owner_principal_id="employee-user",
            domain_id="domain-a", installation_id=str(uuid.uuid4()), display_name="In Scope",
            credential_id="cred-in-scope", status="ACTIVE", reported_version="0.1.0",
            reported_os="linux", reported_arch="x64",
        ))
        session.add(WorkbenchInstance(
            id="wb-out-scope", enrollment_request_id="er2", owner_principal_id="kos-user2",
            domain_id="domain-a", installation_id=str(uuid.uuid4()), display_name="Out Scope",
            credential_id="cred-out-scope", status="ACTIVE", reported_version="0.1.0",
            reported_os="linux", reported_arch="x64",
        ))
        session.commit()

    resp = await client.get("/api/v1/workbenches?q=Employee", headers=dept_admin_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert {i["id"] for i in items} == {"wb-in-scope"}
    assert items[0]["owner_display_name"] == "Employee"
    assert items[0]["org_path"] == "Example Corp-CBB2-Team2"

    by_org = await client.get("/api/v1/workbenches?org_id=cbb2", headers=dept_admin_headers)
    assert {i["id"] for i in by_org.json()["items"]} == {"wb-in-scope"}

    by_keyword = await client.get("/api/v1/workbenches?q=CBB2", headers=dept_admin_headers)
    assert {i["id"] for i in by_keyword.json()["items"]} == {"wb-in-scope"}


async def test_workbench_list_includes_own_pending_enrollment(
    client: AsyncClient, employee_headers, db_factory
):
    with db_factory() as session:
        _org(session, "self-org", "domain-a", "Self Org")
        session.get(IamPrincipal, "employee-user").primary_org_id = "self-org"
        session.commit()

    enrollment = await _submit(client, employee_headers, db_factory, "employee-user", "self-org", "My WB")

    resp = await client.get("/api/v1/workbenches", headers=employee_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert any(
        i["id"] == enrollment["id"] and i["kind"] == "enrollment" and i["status"] == "PENDING_REVIEW"
        for i in items
    )


async def test_builtin_department_admin_sees_team_workbenches_and_approves(
    client: AsyncClient, employee_headers, dept_admin_headers, db_factory
):
    with db_factory() as session:
        _org(session, "rd", "domain-a", "研发部")
        _org(session, "rd-team", "rd", "研发一组")
        session.get(IamPrincipal, "dept-admin-user").primary_org_id = "rd"
        session.add(RoleAssignment(
            id="role-dept-admin-builtin", principal_id="dept-admin-user",
            role_code=RoleCode.DEPARTMENT_ADMIN, scope_type=ScopeType.DEPARTMENT_SET,
            domain_id="domain-a", status="ACTIVE", created_by="bootstrap",
        ))
        session.flush()
        from app.models import RoleAssignmentDepartment
        session.add(RoleAssignmentDepartment(role_assignment_id="role-dept-admin-builtin", department_id="rd"))
        session.commit()

    pending = await _submit(client, employee_headers, db_factory, "employee-user", "rd-team", "Pending WB")

    listed = await client.get("/api/v1/workbenches", headers=dept_admin_headers)
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert any(i["id"] == pending["id"] and i["kind"] == "enrollment" for i in items)

    approve = await client.post(f"/api/v1/workbench-enrollments/{pending['id']}/approve", headers=dept_admin_headers)
    assert approve.status_code == 200, approve.text
