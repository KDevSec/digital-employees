import uuid

from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent


PAYLOAD = {
    "title": "工作台无法登录",
    "category": "BUG",
    "description": "点击登录后页面白屏，控制台报错 token 无效。",
    "priority": "HIGH",
    "contact": "employee@example.com",
}


async def test_unauthenticated_submit_rejected(client: AsyncClient):
    resp = await client.post("/api/v1/feedback", json=PAYLOAD)
    assert resp.status_code == 401


async def test_employee_submit_creates_open_feedback_with_audit(
    client: AsyncClient, employee_headers, db_factory
):
    resp = await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "OPEN"
    assert body["priority"] == "HIGH"
    assert body["category"] == "BUG"
    assert body["title"] == PAYLOAD["title"]
    feedback_id = body["id"]

    with db_factory() as session:
        ev = session.scalar(
            select(AuditEvent).where(
                AuditEvent.event_type == "FEEDBACK_CREATED",
                AuditEvent.target_id == feedback_id,
            )
        )
        assert ev is not None
        assert ev.actor_id == "employee-user"


async def test_invalid_fields_rejected(client: AsyncClient, employee_headers):
    bad = {k: v for k, v in PAYLOAD.items() if k != "title"}
    resp = await client.post("/api/v1/feedback", json=bad, headers=employee_headers)
    assert resp.status_code == 422
    resp = await client.post("/api/v1/feedback", json=dict(PAYLOAD, description="x" * 5001), headers=employee_headers)
    assert resp.status_code == 422


async def test_system_admin_lists_with_submitter_name(
    client: AsyncClient, employee_headers, system_headers
):
    resp = await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)
    assert resp.status_code == 201
    resp = await client.get("/api/v1/admin/feedback", headers=system_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert any(i["submitter_display_name"] == "Employee" for i in items)


async def test_platform_admin_update_records_audit(
    client: AsyncClient, employee_headers, db_factory
):
    headers = {"Authorization": "Bearer test-platform"}
    created = (await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)).json()
    fid = created["id"]
    resp = await client.patch(
        f"/api/v1/admin/feedback/{fid}",
        json={"status": "IN_PROGRESS", "admin_reply": "已复现，处理中"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "IN_PROGRESS"
    assert body["admin_reply"] == "已复现，处理中"
    with db_factory() as session:
        ev = session.scalar(
            select(AuditEvent).where(
                AuditEvent.event_type == "FEEDBACK_UPDATED",
                AuditEvent.target_id == fid,
            )
        )
        assert ev is not None


async def test_non_admin_cannot_access_admin_endpoints(client: AsyncClient, dept_admin_headers):
    resp = await client.get("/api/v1/admin/feedback", headers=dept_admin_headers)
    assert resp.status_code == 403


async def test_invalid_status_transition_rejected(
    client: AsyncClient, employee_headers, system_headers
):
    fid = (await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)).json()["id"]
    resp = await client.patch(f"/api/v1/admin/feedback/{fid}", json={"status": "CLOSED"}, headers=system_headers)
    assert resp.status_code == 200, resp.text
    resp = await client.patch(f"/api/v1/admin/feedback/{fid}", json={"status": "IN_PROGRESS"}, headers=system_headers)
    assert resp.status_code == 409


async def test_mine_returns_only_own(client: AsyncClient, employee_headers, dept_admin_headers):
    await client.post("/api/v1/feedback", json=PAYLOAD, headers=dept_admin_headers)
    emp = (await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)).json()
    resp = await client.get("/api/v1/feedback/mine", headers=employee_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == emp["id"]


async def test_owner_can_view_detail_with_reply(client: AsyncClient, employee_headers, system_headers):
    fid = (await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)).json()["id"]
    await client.patch(f"/api/v1/admin/feedback/{fid}", json={"admin_reply": "已修复"}, headers=system_headers)
    resp = await client.get(f"/api/v1/feedback/{fid}", headers=employee_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["admin_reply"] == "已修复"


async def test_cross_user_detail_forbidden_and_not_found(
    client: AsyncClient, employee_headers, dept_admin_headers
):
    fid = (await client.post("/api/v1/feedback", json=PAYLOAD, headers=employee_headers)).json()["id"]
    resp = await client.get(f"/api/v1/feedback/{fid}", headers=dept_admin_headers)
    assert resp.status_code == 403
    resp = await client.get(f"/api/v1/feedback/{uuid.uuid4()}", headers=employee_headers)
    assert resp.status_code == 404


async def test_admin_filter_and_order(client: AsyncClient, employee_headers, system_headers):
    base = dict(PAYLOAD, title="filter-test-unique")
    a = (await client.post("/api/v1/feedback", json=dict(base, category="BUG"), headers=employee_headers)).json()
    b = (await client.post("/api/v1/feedback", json=dict(base, category="SUGGESTION"), headers=employee_headers)).json()
    resp = await client.get("/api/v1/admin/feedback?category=BUG&q=filter-test-unique", headers=system_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(i["category"] == "BUG" for i in data["items"])
    resp = await client.get("/api/v1/admin/feedback?q=filter-test-unique", headers=system_headers)
    items = resp.json()["items"]
    ids = [i["id"] for i in items]
    assert b["id"] in ids and a["id"] in ids
    assert ids.index(b["id"]) < ids.index(a["id"])
