from httpx import AsyncClient


async def test_discovery_is_public_and_contains_frozen_endpoints(client: AsyncClient) -> None:
    response = await client.get("/.well-known/workbench-configuration")

    assert response.status_code == 200
    assert response.json() == {
        "platform_base_url": "http://localhost:18000",
        "oidc_issuer": "https://iam.test/realms/digital",
        "oidc_client_id": "workbench-desktop",
        "enrollment_endpoint": "http://localhost:18000/api/v1/workbench-enrollments",
        "machine_token_endpoint": "http://localhost:18000/oauth2/workbench/token",
        "protocol_version": "1",
    }


async def test_me_returns_stable_identity_and_roles(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    response = await client.get("/api/v1/me", headers=system_headers)

    assert response.status_code == 200
    assert response.json()["principal"]["id"] == "system-user"
    assert response.json()["roles"][0]["role_code"] == "SYSTEM_ADMIN"
    assert "role.manage" in response.json()["permissions"]


async def test_system_admin_updates_only_whitelisted_settings(
    client: AsyncClient,
    system_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    body = {
        "challenge_ttl_seconds": 240,
        "machine_token_ttl_seconds": 180,
        "heartbeat_offline_seconds": 120,
    }
    denied = await client.put("/api/v1/platform-settings", headers=employee_headers, json=body)
    assert denied.status_code == 403

    updated = await client.put("/api/v1/platform-settings", headers=system_headers, json=body)
    assert updated.status_code == 200, updated.text
    assert updated.json()["challenge_ttl_seconds"] == 240
    assert updated.json()["machine_token_ttl_seconds"] == 180

    invalid = await client.put(
        "/api/v1/platform-settings",
        headers=system_headers,
        json={**body, "challenge_ttl_seconds": 30},
    )
    assert invalid.status_code == 422


async def test_audit_records_operation_without_sensitive_payload(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    secret_content = b"audit-secret-must-not-appear"
    uploaded = await client.post(
        "/api/v1/admin/workbench-packages",
        headers=system_headers,
        data={"version": "2.0.0", "os": "linux", "arch": "arm64", "signature_status": "VALID"},
        files={"file": ("secret.bin", secret_content, "application/octet-stream")},
    )
    assert uploaded.status_code == 201

    audit = await client.get("/api/v1/audit-events?event_type=PACKAGE_UPLOADED", headers=system_headers)
    assert audit.status_code == 200
    serialized = audit.text
    assert "PACKAGE_UPLOADED" in serialized
    assert secret_content.decode() not in serialized


async def test_iam_snapshots_are_read_only_and_searchable(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    domains = await client.get("/api/v1/iam/domains", headers=system_headers)
    departments = await client.get("/api/v1/iam/domains/domain-a/departments", headers=system_headers)
    principals = await client.get("/api/v1/iam/principals?query=Employee", headers=system_headers)

    assert domains.json() == [{"id": "domain-a", "name": "Example Corp", "status": "ACTIVE"}]
    assert departments.json()[0]["id"] == "dept-a"
    assert principals.json()[0]["username"] == "employee"
    assert (await client.post("/api/v1/iam/principals", headers=system_headers, json={})).status_code == 405


async def test_authentication_failure_is_audited_without_request_credentials(
    client: AsyncClient,
    system_headers: dict[str, str],
) -> None:
    secret_bearer = "secret-bearer-must-not-appear"
    denied = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {secret_bearer}"},
    )
    assert denied.status_code == 401

    audit = await client.get(
        "/api/v1/audit-events?event_type=AUTHENTICATION_FAILED",
        headers=system_headers,
    )
    assert audit.status_code == 200
    assert secret_bearer not in audit.text
    assert audit.json()[0]["reason_code"] == "PERSON_SESSION_INVALID"
