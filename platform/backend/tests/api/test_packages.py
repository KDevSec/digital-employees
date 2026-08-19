import hashlib

from httpx import AsyncClient


async def upload_package(client: AsyncClient, headers: dict[str, str], content: bytes = b"real package bytes") -> dict:
    response = await client.post(
        "/api/v1/admin/workbench-packages",
        headers=headers,
        data={"version": "1.0.0", "os": "linux", "arch": "x64", "signature_status": "VALID"},
        files={"file": ("workbench.bin", content, "application/octet-stream")},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_anonymous_users_only_see_and_download_published_packages(
    client: AsyncClient, system_headers: dict[str, str]
) -> None:
    content = b"unique package content"
    package = await upload_package(client, system_headers, content)

    assert (await client.get("/api/v1/public/workbench-packages")).json() == []
    assert (await client.get(f"/api/v1/public/workbench-packages/{package['id']}/download")).status_code == 404

    published = await client.post(
        f"/api/v1/admin/workbench-packages/{package['id']}/publish", headers=system_headers
    )
    assert published.status_code == 200

    listing = await client.get("/api/v1/public/workbench-packages")
    assert listing.status_code == 200
    assert listing.json()[0]["sha256"] == hashlib.sha256(content).hexdigest()
    download = await client.get(f"/api/v1/public/workbench-packages/{package['id']}/download")
    assert download.status_code == 200
    assert download.content == content

    assert (await client.post(
        f"/api/v1/admin/workbench-packages/{package['id']}/withdraw", headers=system_headers
    )).status_code == 200
    assert (await client.get("/api/v1/public/workbench-packages")).json() == []
    assert (await client.get(f"/api/v1/public/workbench-packages/{package['id']}/download")).status_code == 404


async def test_employee_cannot_manage_packages(
    client: AsyncClient,
    employee_headers: dict[str, str],
    audit_admin_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/admin/workbench-packages",
        headers=employee_headers,
        data={"version": "1.0.0", "os": "linux", "arch": "x64", "signature_status": "VALID"},
        files={"file": ("workbench.bin", b"content", "application/octet-stream")},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PERMISSION_DENIED"

    audit = await client.get(
        "/api/v1/audit-events?event_type=AUTHORIZATION_DENIED",
        headers=audit_admin_headers,
    )
    assert audit.status_code == 200
    assert len(audit.json()["items"]) == 1
    assert audit.json()["items"][0]["result"] == "FAILURE"
    assert audit.json()["items"][0]["reason_code"] == "PERMISSION_DENIED"
