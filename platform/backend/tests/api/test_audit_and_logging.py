import uuid
from httpx import AsyncClient

from app.models import AuditEvent


async def test_audit_requires_audit_admin(
    client: AsyncClient, employee_headers, dept_admin_headers, system_headers, db_factory
):
    with db_factory() as session:
        # Give employee an audit event via direct insert
        session.add(AuditEvent(
            id=str(uuid.uuid4()), event_type="TEST_EVENT", category="OPERATION",
            actor_type="PERSON", actor_id="employee-user", target_type="TEST",
            target_id="t1", domain_id_snapshot="domain-a", result="SUCCESS",
            summary="test event", trace_id="trace-1",
        ))
        session.commit()

    # Employee has no audit.read
    resp = await client.get("/api/v1/audit-events", headers=employee_headers)
    assert resp.status_code == 403

    # Dept admin has no audit.read anymore
    resp = await client.get("/api/v1/audit-events", headers=dept_admin_headers)
    assert resp.status_code == 403

    # System admin can also view audit
    resp = await client.get("/api/v1/audit-events", headers=system_headers)
    assert resp.status_code == 200


async def test_audit_admin_sees_events_with_actor_name(
    client: AsyncClient, db_factory
):
    with db_factory() as session:
        session.add(AuditEvent(
            id=str(uuid.uuid4()), event_type="ENROLLMENT_APPROVED", category="OPERATION",
            actor_type="PERSON", actor_id="employee-user", target_type="ENROLLMENT_REQUEST",
            target_id="er-1", domain_id_snapshot="domain-a", result="SUCCESS",
            summary="Approved workbench enrollment", trace_id="trace-2",
        ))
        session.commit()

    headers = {"Authorization": "Bearer test-audit-admin"}
    resp = await client.get("/api/v1/audit-events", headers=headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) >= 1
    event = items[0]
    assert event["actor_display_name"] == "Employee"
    assert event["category"] in ("OPERATION", "SECURITY", "AUTH")


async def test_audit_filter_by_category_and_result(
    client: AsyncClient, db_factory
):
    with db_factory() as session:
        session.add(AuditEvent(
            id=str(uuid.uuid4()), event_type="LOGIN_FAILED", category="AUTH",
            actor_type="ANONYMOUS", target_type="HTTP_ENDPOINT", target_id="/auth/callback",
            domain_id_snapshot="domain-a", result="FAILURE", reason_code="BAD_CREDENTIALS",
            summary="Login failed", trace_id="trace-3",
        ))
        session.commit()

    headers = {"Authorization": "Bearer test-audit-admin"}
    resp = await client.get("/api/v1/audit-events?category=AUTH&result=FAILURE", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["category"] == "AUTH" and i["result"] == "FAILURE" for i in items)


async def test_system_logs_requires_system_admin(
    client: AsyncClient, employee_headers, dept_admin_headers, system_headers
):
    resp = await client.get("/api/v1/system-logs", headers=employee_headers)
    assert resp.status_code == 403
    resp = await client.get("/api/v1/system-logs", headers=dept_admin_headers)
    assert resp.status_code == 403
    # System admin can access
    resp = await client.get("/api/v1/system-logs", headers=system_headers)
    assert resp.status_code == 200


async def test_settings_include_log_options(
    client: AsyncClient, system_headers
):
    resp = await client.get("/api/v1/platform-settings", headers=system_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "log_level" in data
    assert "log_dir" in data

    # Update log level
    resp = await client.put(
        "/api/v1/platform-settings",
        headers=system_headers,
        json={"log_level": "DEBUG"},
    )
    assert resp.status_code == 200
    assert resp.json()["log_level"] == "DEBUG"


async def test_settings_log_rotation_fields(client: AsyncClient, system_headers):
    resp = await client.get("/api/v1/platform-settings", headers=system_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["log_max_mb"] == 10
    assert data["log_retention_days"] == 7
    assert data["log_compress"] is True

    resp = await client.put(
        "/api/v1/platform-settings",
        headers=system_headers,
        json={"log_max_mb": 5, "log_retention_days": 14, "log_compress": False},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["log_max_mb"] == 5
    assert body["log_retention_days"] == 14
    assert body["log_compress"] is False
