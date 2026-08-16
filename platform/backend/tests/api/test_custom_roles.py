from httpx import AsyncClient


async def test_system_admin_can_create_custom_role_and_scoped_organization_grant(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    permissions = await client.get("/api/v1/permissions", headers=system_headers)
    assert permissions.status_code == 200
    assert "organization.member.manage" in {item["code"] for item in permissions.json()}

    role = await client.post(
        "/api/v1/roles",
        headers=system_headers,
        json={
            "domain_id": "domain-a",
            "code": "cbb-admin",
            "name": "CBB团队管理员",
            "description": "管理 CBB 团队",
            "permission_codes": ["organization.read", "organization.member.manage"],
        },
    )
    assert role.status_code == 201, role.text

    grant = await client.post(
        "/api/v1/role-grants",
        headers={**system_headers, "Idempotency-Key": "grant-cbb-admin"},
        json={
            "role_id": role.json()["id"],
            "subject_type": "ORGANIZATION",
            "subject_id": "domain-a",
            "subject_include_descendants": True,
            "scope_org_id": "domain-a",
            "scope_include_descendants": True,
        },
    )
    assert grant.status_code == 201, grant.text
    assert grant.json()["role_id"] == role.json()["id"]
    assert grant.json()["scope_include_descendants"] is True


async def test_employee_cannot_create_custom_role(
    client: AsyncClient, employee_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/roles",
        headers=employee_headers,
        json={
            "domain_id": "domain-a",
            "code": "forbidden",
            "name": "Forbidden",
            "permission_codes": ["organization.read"],
        },
    )
    assert response.status_code == 403
