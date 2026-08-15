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
