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


async def test_delegated_admin_cannot_delegate_undelegatable_or_out_of_scope_permissions(
    client: AsyncClient, system_headers: dict[str, str], employee_headers: dict[str, str], db_factory
) -> None:
    from app.models import IamPrincipal

    async def create_org(code: str, parent: str) -> dict:
        response = await client.post(
            "/api/v1/org-nodes",
            headers={**system_headers, "Idempotency-Key": f"delegate-{code}"},
            json={"parent_id": parent, "org_code": code, "org_type": "ORG_UNIT", "name": code},
        )
        assert response.status_code == 201, response.text
        return response.json()

    cbb = await create_org("delegate-cbb", "domain-a")
    kos = await create_org("delegate-kos", "domain-a")
    cbb_detail = await client.get(f"/api/v1/org-nodes/{cbb['id']}", headers=system_headers)
    assert cbb_detail.status_code == 200
    with db_factory.begin() as session:
        session.add(
            IamPrincipal(
                id="delegated-target",
                issuer="https://iam.test/realms/digital",
                subject="sub-delegated-target",
                username="delegated-target",
                display_name="Delegated Target",
                domain_id="domain-a",
                department_id="dept-a",
                primary_org_id=cbb["id"],
                status="ACTIVE",
            )
        )
    delegator = await client.post(
        "/api/v1/roles",
        headers=system_headers,
        json={
            "domain_id": "domain-a",
            "code": "cbb-delegator",
            "name": "CBB Delegator",
            "permission_codes": ["role.assign", "organization.member.manage"],
        },
    )
    assert delegator.status_code == 201, delegator.text
    grant = await client.post(
        "/api/v1/role-grants",
        headers={**system_headers, "Idempotency-Key": "delegate-cbb-delegator"},
        json={
            "role_id": delegator.json()["id"],
            "subject_type": "PRINCIPAL",
            "subject_id": "employee-user",
            "scope_org_id": cbb["id"],
            "scope_include_descendants": True,
        },
    )
    assert grant.status_code == 201, grant.text

    allowed_role = await client.post(
        "/api/v1/roles",
        headers=employee_headers,
        json={
            "domain_id": "domain-a",
            "code": "cbb-member-admin",
            "name": "CBB Member Admin",
            "permission_codes": ["organization.member.manage"],
        },
    )
    assert allowed_role.status_code == 201, allowed_role.text

    undelegatable = await client.post(
        "/api/v1/roles",
        headers=employee_headers,
        json={
            "domain_id": "domain-a",
            "code": "security-escapist",
            "name": "Security Escapist",
            "permission_codes": ["organization.member.manage", "audit.security.read"],
        },
    )
    assert undelegatable.status_code == 403

    allowed_grant = await client.post(
        "/api/v1/role-grants",
        headers={**employee_headers, "Idempotency-Key": "delegate-allowed-grant"},
        json={
            "role_id": allowed_role.json()["id"],
            "subject_type": "PRINCIPAL",
            "subject_id": "delegated-target",
            "scope_org_id": cbb["id"],
            "scope_include_descendants": True,
        },
    )
    assert allowed_grant.status_code == 201, allowed_grant.text

    self_escalation = await client.post(
        "/api/v1/role-grants",
        headers={**employee_headers, "Idempotency-Key": "delegate-self-escalation"},
        json={
            "role_id": allowed_role.json()["id"],
            "subject_type": "PRINCIPAL",
            "subject_id": "employee-user",
            "scope_org_id": cbb["id"],
            "scope_include_descendants": True,
        },
    )
    assert self_escalation.status_code == 403

    role_bypass = await client.patch(
        f"/api/v1/roles/{allowed_role.json()['id']}",
        headers=employee_headers,
        json={"version": allowed_role.json()["version"], "permission_codes": ["audit.security.read"]},
    )
    assert role_bypass.status_code == 403


async def test_effective_permissions_explain_fixed_and_scoped_sources(
    client: AsyncClient, employee_headers: dict[str, str]
) -> None:
    response = await client.get("/api/v1/me/effective-permissions", headers=employee_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert "workbench.read" in body["permissions"]
    assert any(source["source_type"] == "FIXED_ROLE" for source in body["sources"])
