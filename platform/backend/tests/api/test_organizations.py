from httpx import AsyncClient


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
