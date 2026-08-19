from httpx import AsyncClient

from app.models import IamPrincipal, IamPrincipalOrg


async def test_system_admin_can_create_arbitrarily_nested_organizations(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    parent_id = "domain-a"
    for index in range(1, 9):
        response = await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": f"create-org-{index}"},
            json={
                "parent_id": parent_id,
                "org_code": f"level-{index}",
                "org_type": "ORG_UNIT",
                "name": f"Level {index}",
                "sort_order": index,
            },
        )
        assert response.status_code == 201, response.text
        parent_id = response.json()["id"]

    tree = await client.get(
        "/api/v1/org-nodes/tree",
        headers=system_headers,
        params={"parent_id": parent_id},
    )
    assert tree.status_code == 200
    assert tree.json() == []

    detail = await client.get(f"/api/v1/org-nodes/{parent_id}", headers=system_headers)
    assert detail.status_code == 200
    assert len(detail.json()["ancestors"]) == 8
    assert detail.json()["name"] == "Level 8"


async def test_employee_cannot_manage_organizations(
    client: AsyncClient, employee_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/org-nodes",
        headers={**employee_headers, "Idempotency-Key": "employee-create"},
        json={"parent_id": "domain-a", "org_code": "forbidden", "org_type": "TEAM", "name": "Forbidden"},
    )

    assert response.status_code == 403


async def test_rename_uses_optimistic_version_and_preserves_identity(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "rename-create"},
        json={"parent_id": "domain-a", "org_code": "cbb", "org_type": "TEAM", "name": "CBB团队"},
    )
    node = created.json()
    renamed = await client.patch(
        f"/api/v1/org-nodes/{node['id']}",
        headers=system_headers,
        json={"version": node["version"], "name": "CBB核心团队"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["id"] == node["id"]
    assert renamed.json()["keycloak_group_id"] == node["keycloak_group_id"]
    assert renamed.json()["version"] == 2

    stale = await client.patch(
        f"/api/v1/org-nodes/{node['id']}",
        headers=system_headers,
        json={"version": 1, "name": "stale"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"


async def test_move_rebuilds_closure_and_rejects_cycles(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    async def create(code: str, parent: str) -> dict:
        response = await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": f"move-{code}"},
            json={"parent_id": parent, "org_code": code, "org_type": "ORG_UNIT", "name": code},
        )
        assert response.status_code == 201
        return response.json()

    left = await create("left", "domain-a")
    right = await create("right", "domain-a")
    child = await create("child", left["id"])
    moved = await client.post(
        f"/api/v1/org-nodes/{left['id']}/move",
        headers={**system_headers, "Idempotency-Key": "move-left-under-right"},
        json={"version": left["version"], "new_parent_id": right["id"]},
    )
    assert moved.status_code == 200, moved.text
    child_detail = await client.get(f"/api/v1/org-nodes/{child['id']}", headers=system_headers)
    assert right["id"] in child_detail.json()["ancestors"]

    cycle = await client.post(
        f"/api/v1/org-nodes/{right['id']}/move",
        headers={**system_headers, "Idempotency-Key": "move-cycle"},
        json={"version": right["version"], "new_parent_id": child["id"]},
    )
    assert cycle.status_code == 422
    assert cycle.json()["error"]["code"] == "ORG_CYCLE"


async def test_person_can_have_one_primary_and_multiple_collaboration_organizations(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    async def create(code: str) -> dict:
        response = await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": f"member-{code}"},
            json={"parent_id": "domain-a", "org_code": code, "org_type": "TEAM", "name": code},
        )
        return response.json()

    security = await create("security")
    kdevsec = await create("kdevsec")
    ksec = await create("ksec")
    primary = await client.put(
        "/api/v1/principals/employee-user/primary-org",
        headers={**system_headers, "Idempotency-Key": "primary-security"},
        json={"org_id": security["id"]},
    )
    assert primary.status_code == 200, primary.text
    for org in (kdevsec, ksec):
        collaboration = await client.post(
            "/api/v1/principals/employee-user/collaborations",
            headers={**system_headers, "Idempotency-Key": f"collaboration-{org['id']}"},
            json={"org_id": org["id"]},
        )
        assert collaboration.status_code == 201, collaboration.text

    detail = await client.get("/api/v1/principals/employee-user/organizations", headers=system_headers)
    assert detail.status_code == 200
    assert detail.json()["primary_org_id"] == security["id"]
    assert {item["org_id"] for item in detail.json()["collaborations"]} == {kdevsec["id"], ksec["id"]}

    overlap = await client.post(
        "/api/v1/principals/employee-user/collaborations",
        headers={**system_headers, "Idempotency-Key": "collaboration-overlap"},
        json={"org_id": security["id"]},
    )
    assert overlap.status_code == 409


async def test_scoped_grant_authorizes_organization_reads_within_descendants_only(
    client: AsyncClient, system_headers: dict[str, str], employee_headers: dict[str, str]
) -> None:
    async def create(code: str, parent: str) -> dict:
        response = await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": f"scoped-{code}"},
            json={"parent_id": parent, "org_code": code, "org_type": "ORG_UNIT", "name": code},
        )
        assert response.status_code == 201, response.text
        return response.json()

    cbb = await create("scoped-cbb", "domain-a")
    security = await create("scoped-security", cbb["id"])
    kos = await create("scoped-kos", "domain-a")
    role = await client.post(
        "/api/v1/roles",
        headers=system_headers,
        json={
            "domain_id": "domain-a",
            "code": "security-reader",
            "name": "Security Reader",
            "permission_codes": ["organization.read"],
        },
    )
    assert role.status_code == 201, role.text
    grant = await client.post(
        "/api/v1/role-grants",
        headers={**system_headers, "Idempotency-Key": "scoped-security-reader"},
        json={
            "role_id": role.json()["id"],
            "subject_type": "PRINCIPAL",
            "subject_id": "employee-user",
            "subject_include_descendants": False,
            "scope_org_id": cbb["id"],
            "scope_include_descendants": True,
        },
    )
    assert grant.status_code == 201, grant.text

    tree = await client.get(
        "/api/v1/org-nodes/tree",
        headers=employee_headers,
        params={"parent_id": "domain-a"},
    )
    assert tree.status_code == 200, tree.text
    assert [item["id"] for item in tree.json()] == [cbb["id"]]

    child_tree = await client.get(
        "/api/v1/org-nodes/tree",
        headers=employee_headers,
        params={"parent_id": cbb["id"]},
    )
    assert child_tree.status_code == 200, child_tree.text
    assert [item["id"] for item in child_tree.json()] == [security["id"]]

    allowed = await client.get(f"/api/v1/org-nodes/{security['id']}", headers=employee_headers)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["id"] == security["id"]

    denied = await client.get(f"/api/v1/org-nodes/{kos['id']}", headers=employee_headers)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "PERMISSION_DENIED"

    revoked = await client.delete(f"/api/v1/role-grants/{grant.json()['id']}", headers=system_headers)
    assert revoked.status_code == 204
    repeat = await client.delete(
        f"/api/v1/role-grants/{grant.json()['id']}", headers=system_headers
    )
    assert repeat.status_code == 204
    expired = await client.get(
        "/api/v1/org-nodes/tree",
        headers=employee_headers,
        params={"parent_id": cbb["id"]},
    )
    assert expired.status_code == 403


async def test_organization_archive_reports_blockers_and_rejects_new_members(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    parent = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "archive-parent"},
        json={"parent_id": "domain-a", "org_code": "archive-parent", "org_type": "ORG_UNIT", "name": "Parent"},
    )
    assert parent.status_code == 201, parent.text
    child = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "archive-child"},
        json={"parent_id": parent.json()["id"], "org_code": "archive-child", "org_type": "TEAM", "name": "Child"},
    )
    assert child.status_code == 201, child.text

    blocked = await client.post(
        f"/api/v1/org-nodes/{parent.json()['id']}/archive",
        headers=system_headers,
        json={"version": parent.json()["version"]},
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "ORG_ARCHIVE_BLOCKED"
    assert blocked.json()["error"]["details"]["blockers"] == ["children"]

    archived = await client.post(
        f"/api/v1/org-nodes/{child.json()['id']}/archive",
        headers=system_headers,
        json={"version": child.json()["version"]},
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "ARCHIVED"

    membership = await client.post(
        "/api/v1/principals/employee-user/collaborations",
        headers={**system_headers, "Idempotency-Key": "archive-member"},
        json={"org_id": child.json()["id"]},
    )
    assert membership.status_code == 404


async def test_reused_idempotency_key_with_different_payload_returns_conflict(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "same-idempotency-key"},
        json={"parent_id": "domain-a", "org_code": "idem-first", "org_type": "TEAM", "name": "First"},
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "same-idempotency-key"},
        json={"parent_id": "domain-a", "org_code": "idem-second", "org_type": "TEAM", "name": "Second"},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


async def test_disabling_principal_invalidates_sessions_and_protects_last_system_admin(
    client: AsyncClient,
    system_headers: dict[str, str],
    db_factory,
) -> None:
    from datetime import UTC, datetime, timedelta

    from app.auth.sessions import session_token_hash
    from app.models import BffSession

    with db_factory.begin() as session:
        session.add(
            BffSession(
                id_hash=session_token_hash("employee-active-session"),
                principal_id="employee-user",
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )

    disabled = await client.patch(
        "/api/v1/principals/employee-user/status",
        headers=system_headers,
        json={"status": "DISABLED"},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "DISABLED"

    denied = await client.get("/api/v1/me", cookies={"platform_session": "employee-active-session"})
    assert denied.status_code == 401

    last_admin = await client.patch(
        "/api/v1/principals/system-user/status",
        headers=system_headers,
        json={"status": "DISABLED"},
    )
    assert last_admin.status_code == 409
    assert last_admin.json()["error"]["code"] == "LAST_SYSTEM_ADMIN"


async def test_remove_collaboration_is_idempotent_and_invalidates_authorization_version(
    client: AsyncClient, system_headers: dict[str, str], db_factory
) -> None:
    from app.models import IamPrincipal

    org = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "remove-collab-org"},
        json={"parent_id": "domain-a", "org_code": "remove-collab", "org_type": "TEAM", "name": "Remove Collab"},
    )
    assert org.status_code == 201, org.text
    with db_factory() as session:
        before = session.get(IamPrincipal, "employee-user").authorization_version
    added = await client.post(
        "/api/v1/principals/employee-user/collaborations",
        headers={**system_headers, "Idempotency-Key": "remove-collab-add"},
        json={"org_id": org.json()["id"]},
    )
    assert added.status_code == 201, added.text

    removed = await client.delete(
        f"/api/v1/principals/employee-user/collaborations/{org.json()['id']}",
        headers=system_headers,
    )
    assert removed.status_code == 204
    repeat = await client.delete(
        f"/api/v1/principals/employee-user/collaborations/{org.json()['id']}",
        headers=system_headers,
    )
    assert repeat.status_code == 204
    detail = await client.get("/api/v1/principals/employee-user/organizations", headers=system_headers)
    assert detail.status_code == 200
    assert detail.json()["collaborations"] == []
    with db_factory() as session:
        after = session.get(IamPrincipal, "employee-user").authorization_version
    assert after == before + 2


async def test_principal_org_context_returns_full_path_and_collaborations(
    client: AsyncClient, system_headers: dict[str, str], db_factory
) -> None:
    rd = (
        await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": "ctx-rd"},
            json={"parent_id": "domain-a", "org_code": "rd", "org_type": "DEPARTMENT", "name": "研发部"},
        )
    ).json()
    team = (
        await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": "ctx-team"},
            json={"parent_id": rd["id"], "org_code": "platform", "org_type": "TEAM", "name": "平台组"},
        )
    ).json()

    from uuid import uuid4

    with db_factory.begin() as session:
        principal = session.get(IamPrincipal, "system-user")
        principal.primary_org_id = team["id"]
        session.add(
            IamPrincipalOrg(
                id=str(uuid4()),
                principal_id="system-user",
                org_id=rd["id"],
                membership_type="COLLABORATION",
                status="ACTIVE",
            )
        )

    response = await client.get("/api/v1/principals/system-user/org-context", headers=system_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["domain"]["name"] == "Example Corp"
    assert body["department"]["id"] == "dept-a"
    assert body["primary_org"]["id"] == team["id"]
    assert [node["name"] for node in body["primary_org_path"]] == ["Example Corp", "研发部", "平台组"]
    assert body["collaborations"][0]["name"] == "研发部"


async def test_org_context_404_for_missing_principal(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    response = await client.get("/api/v1/principals/no-such-user/org-context", headers=system_headers)
    assert response.status_code == 404


async def test_iam_teams_endpoint_and_principal_team_filter(
    client: AsyncClient, system_headers: dict[str, str], db_factory
) -> None:
    from app.models import IamTeam

    with db_factory.begin() as session:
        session.add(IamTeam(id="team-platform", department_id="dept-a", name="平台组", status="ACTIVE"))
        principal = session.get(IamPrincipal, "employee-user")
        principal.team_id = "team-platform"

    teams = await client.get("/api/v1/iam/teams", headers=system_headers, params={"department_id": "dept-a"})
    assert teams.status_code == 200
    assert any(t["id"] == "team-platform" for t in teams.json())

    filtered = await client.get(
        "/api/v1/iam/principals", headers=system_headers, params={"team_id": "team-platform"}
    )
    assert filtered.status_code == 200
    assert any(p["id"] == "employee-user" for p in filtered.json()["items"])

    other = await client.get(
        "/api/v1/iam/principals", headers=system_headers, params={"team_id": "no-such-team"}
    )
    assert other.status_code == 200
    assert other.json()["total"] == 0


async def test_authorization_overview_org_nodes_include_hierarchy(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    dept = (
        await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": "overview-dept"},
            json={"parent_id": "domain-a", "org_code": "overview-rd", "org_type": "DEPARTMENT", "name": "研发部"},
        )
    ).json()

    response = await client.get("/api/v1/authorization/overview", headers=system_headers)
    assert response.status_code == 200
    nodes = {n["id"]: n for n in response.json()["org_nodes"]}
    assert "domain-a" in nodes
    assert nodes["domain-a"]["parent_id"] is None
    assert nodes["domain-a"]["org_type"] == "DOMAIN"
    assert nodes[dept["id"]]["parent_id"] == "domain-a"
    assert nodes[dept["id"]]["org_type"] == "DEPARTMENT"


async def test_iam_principals_returns_org_path(
    client: AsyncClient, system_headers: dict[str, str], db_factory
) -> None:
    dept = (
        await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": "orgpath-rd"},
            json={
                "parent_id": "domain-a",
                "org_code": "orgpath-rd",
                "org_type": "DEPARTMENT",
                "name": "研发部",
            },
        )
    ).json()
    with db_factory.begin() as session:
        principal = session.get(IamPrincipal, "employee-user")
        principal.primary_org_id = dept["id"]

    response = await client.get("/api/v1/iam/principals", headers=system_headers)
    assert response.status_code == 200
    employee = next(p for p in response.json()["items"] if p["id"] == "employee-user")
    assert employee["org_path"] == "Example Corp / 研发部"

    system = next(p for p in response.json()["items"] if p["id"] == "system-user")
    assert system["org_path"] == ""
