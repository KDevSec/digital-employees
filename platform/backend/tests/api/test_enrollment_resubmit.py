"""023: 接入申请重申——拒绝后重申、组织变动后重申作废旧申请并重新快照。"""
import uuid

from httpx import AsyncClient
from sqlalchemy import func, select

from app.domain.crypto import create_es256_key_pair
from app.models import EnrollmentRequest, IamPrincipal, WorkbenchInstance


def enrollment_payload(public_jwk: dict) -> dict:
    return {
        "installation_id": str(uuid.uuid4()),
        "public_key": public_jwk,
        "display_name": "重申终端",
        "workbench_version": "2.0.0",
        "os": "linux",
        "arch": "x64",
    }


async def _submit(client: AsyncClient, headers: dict, payload: dict) -> dict:
    resp = await client.post("/api/v1/workbench-enrollments", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_rejected_resubmission_creates_new_pending_and_cancels_old(
    client: AsyncClient, employee_headers: dict, system_headers: dict, db_factory
):
    _, public_jwk = create_es256_key_pair()
    payload = enrollment_payload(public_jwk)

    first = await _submit(client, employee_headers, payload)
    assert first["status"] == "PENDING_REVIEW"
    await client.post(f"/api/v1/workbench-enrollments/{first['id']}/reject",
                      headers=system_headers, json={"reason": "信息不全"})

    second = await _submit(client, employee_headers, payload)
    assert second["status"] == "PENDING_REVIEW"
    assert second["id"] != first["id"]

    with db_factory() as session:
        old = session.get(EnrollmentRequest, first["id"])
        assert old.status == "CANCELLED"
        statuses = [r.status for r in session.scalars(
            select(EnrollmentRequest).where(EnrollmentRequest.owner_principal_id == "employee-user")
        ).all()]
        assert statuses.count("PENDING_REVIEW") == 1
        assert "CANCELLED" in statuses


async def test_resubmission_after_org_change_snapshots_current_org(
    client: AsyncClient, employee_headers: dict, db_factory
):
    _, public_jwk = create_es256_key_pair()
    payload = enrollment_payload(public_jwk)

    first = await _submit(client, employee_headers, payload)
    assert first["status"] == "PENDING_REVIEW"

    # 用户之后加入组织 org-team-a
    with db_factory() as session:
        principal = session.get(IamPrincipal, "employee-user")
        principal.primary_org_id = "org-team-a"
        session.commit()

    second = await _submit(client, employee_headers, payload)
    assert second["id"] != first["id"]
    with db_factory() as session:
        new_req = session.get(EnrollmentRequest, second["id"])
        assert new_req.status == "PENDING_REVIEW"
        assert new_req.owner_primary_org_id == "org-team-a"
        old = session.get(EnrollmentRequest, first["id"])
        assert old.status == "CANCELLED"


async def test_resubmission_is_idempotent_when_active_terminal_exists(
    client: AsyncClient, employee_headers: dict, db_factory
):
    _, public_jwk = create_es256_key_pair()
    payload = enrollment_payload(public_jwk)
    first = await _submit(client, employee_headers, payload)

    # 模拟已激活的终端实例
    with db_factory() as session:
        session.add(WorkbenchInstance(
            id=str(uuid.uuid4()),
            enrollment_request_id=first["id"],
            owner_principal_id="employee-user",
            domain_id="domain-a",
            installation_id=payload["installation_id"],
            display_name="重申终端",
            status="ACTIVE",
            credential_id=str(uuid.uuid4()),
            reported_version="2.0.0",
            reported_os="linux",
            reported_arch="x64",
        ))
        session.commit()

    second = await _submit(client, employee_headers, payload)
    assert second["id"] == first["id"]
    with db_factory() as session:
        pending = session.scalar(
            select(func.count()).select_from(
                select(EnrollmentRequest).where(EnrollmentRequest.status == "PENDING_REVIEW").subquery()
            )
        )
        assert pending == 1
