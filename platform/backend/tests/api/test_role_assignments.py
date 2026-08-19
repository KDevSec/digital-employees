from httpx import AsyncClient


async def test_last_system_admin_cannot_be_revoked(client: AsyncClient, system_headers: dict[str, str]) -> None:
    response = await client.delete("/api/v1/role-assignments/role-system", headers=system_headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LAST_SYSTEM_ADMIN"


async def test_system_admin_can_add_then_revoke_another_system_admin(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/api/v1/role-assignments",
        headers=system_headers,
        json={
            "principal_id": "employee-user",
            "role_code": "SYSTEM_ADMIN",
            "scope_type": "GLOBAL",
            "domain_id": "",
            "department_ids": [],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["domain_id"] is None

    revoked = await client.delete(
        f"/api/v1/role-assignments/{created.json()['id']}", headers=system_headers
    )
    assert revoked.status_code == 204


async def test_department_admin_scope_accepts_org_node_as_department(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/api/v1/org-nodes",
        headers={**system_headers, "Idempotency-Key": "scope-dept-node"},
        json={"parent_id": "domain-a", "org_code": "scope-dept", "org_type": "DEPARTMENT", "name": "研发处"},
    )
    assert created.status_code == 201, created.text
    dept_id = created.json()["id"]

    response = await client.post(
        "/api/v1/role-assignments",
        headers=system_headers,
        json={
            "principal_id": "employee-user",
            "role_code": "DEPARTMENT_ADMIN",
            "scope_type": "DEPARTMENT_SET",
            "department_ids": [dept_id],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["scope_type"] == "DEPARTMENT_SET"
    assert body["domain_id"] == "domain-a"
    assert body["department_ids"] == [dept_id]
