"""Tests for 021-terminal-management: terminal roster visibility, status, metadata."""
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app.domain.authorization import RoleCode, ScopeType
from app.models import (
    EnrollmentRequest,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    RoleAssignment,
    RoleAssignmentDepartment,
    WorkbenchInstance,
)
from app.domain.crypto import create_es256_key_pair


def seed_tree_and_members(db_factory) -> None:
    now = datetime.now(UTC)
    with db_factory() as session:
        session.add_all([
            IamOrgNode(id="org-dept-a", keycloak_group_id="kc-dept-a", domain_id="domain-a",
                       parent_id="domain-a", org_code="dept-a", org_type="DEPARTMENT", name="研发部"),
            IamOrgNode(id="org-team-a", keycloak_group_id="kc-team-a", domain_id="domain-a",
                       parent_id="org-dept-a", org_code="team-a", org_type="TEAM", name="前端组"),
            IamOrgNode(id="org-dept-b", keycloak_group_id="kc-dept-b", domain_id="domain-a",
                       parent_id="domain-a", org_code="dept-b", org_type="DEPARTMENT", name="市场部"),
            IamOrgClosure(ancestor_id="domain-a", descendant_id="org-dept-a", depth=1),
            IamOrgClosure(ancestor_id="org-dept-a", descendant_id="org-dept-a", depth=0),
            IamOrgClosure(ancestor_id="domain-a", descendant_id="org-team-a", depth=2),
            IamOrgClosure(ancestor_id="org-dept-a", descendant_id="org-team-a", depth=1),
            IamOrgClosure(ancestor_id="org-team-a", descendant_id="org-team-a", depth=0),
            IamOrgClosure(ancestor_id="domain-a", descendant_id="org-dept-b", depth=1),
            IamOrgClosure(ancestor_id="org-dept-b", descendant_id="org-dept-b", depth=0),
        ])

        def member(pid: str, name: str, org: str, email: str | None = None) -> IamPrincipal:
            return IamPrincipal(
                id=pid, issuer="https://iam.test/realms/digital", subject=f"sub-{pid}",
                username=pid, display_name=name, email=email,
                domain_id="domain-a", primary_org_id=org, status="ACTIVE",
            )

        online = member("m-online", "在线员工", "org-team-a", "online@example.com")
        offline = member("m-offline", "离线员工", "org-team-a")
        pending = member("m-pending", "申请中员工", "org-dept-a")
        naked = member("m-naked", "未安装员工", "org-dept-a", "naked@example.com")
        other = member("m-other", "外部门员工", "org-dept-b")
        session.add_all([online, offline, pending, naked, other])
        session.flush()

        def make_enrollment(owner: IamPrincipal, status: str) -> EnrollmentRequest:
            return EnrollmentRequest(
                id=str(uuid.uuid4()), owner_principal_id=owner.id,
                owner_primary_org_id=owner.primary_org_id, domain_id_snapshot="domain-a",
                installation_id=str(uuid.uuid4()), public_jwk={"kty": "EC"},
                public_key_thumbprint=f"tp-{owner.id}", display_name=f"终端 {owner.id[:6]}",
                version="2.0.0", os="linux", arch="x64", status=status,
                expires_at=now + timedelta(hours=24),
            )

        enr_online = make_enrollment(online, "COMPLETED")
        enr_offline = make_enrollment(offline, "COMPLETED")
        enr_pending = make_enrollment(pending, "PENDING_REVIEW")
        session.add_all([enr_online, enr_offline, enr_pending])
        session.flush()

        def make_instance(enr: EnrollmentRequest, owner: IamPrincipal, heartbeat: datetime | None,
                          **meta) -> WorkbenchInstance:
            return WorkbenchInstance(
                id=str(uuid.uuid4()), enrollment_request_id=enr.id,
                owner_principal_id=owner.id, domain_id="domain-a",
                department_id="dept-a", installation_id=enr.installation_id,
                display_name=enr.display_name, status="ACTIVE", credential_id=str(uuid.uuid4()),
                reported_version="2.0.0", reported_os="linux", reported_arch="x64",
                first_heartbeat_at=heartbeat, last_heartbeat_at=heartbeat,
                created_at=now - timedelta(days=1), **meta,
            )

        session.add_all([
            make_instance(enr_online, online, now, hostname="online-host",
                          mac_addresses=["aa:bb:cc:dd:ee:11"], public_ip="203.0.113.11"),
            make_instance(enr_offline, offline, now - timedelta(hours=5), hostname="offline-host"),
        ])

        session.add(RoleAssignment(
            id="role-dept-admin-terminal", principal_id="dept-admin-user",
            role_code=RoleCode.DEPARTMENT_ADMIN, scope_type=ScopeType.DEPARTMENT_SET,
            domain_id="domain-a", status="ACTIVE", created_by="bootstrap",
            departments=[RoleAssignmentDepartment(department_id="org-dept-a")],
        ))
        session.commit()


def status_map(items: list[dict]) -> dict[str, str]:
    return {row["owner_principal_id"]: row["install_status"] for row in items}


async def test_employee_cannot_read_team_roster(client: AsyncClient, employee_headers, db_factory):
    seed_tree_and_members(db_factory)
    resp = await client.get("/api/v1/terminal-roster?scope=team", headers=employee_headers)
    assert resp.status_code == 403


async def test_my_roster_only_contains_self_and_not_installed(client: AsyncClient, employee_headers, db_factory):
    seed_tree_and_members(db_factory)
    resp = await client.get("/api/v1/terminal-roster?scope=me", headers=employee_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["owner_principal_id"] == "employee-user"
    assert data["items"][0]["install_status"] == "NOT_INSTALLED"


async def test_dept_admin_team_roster_scoped_and_statuses(client: AsyncClient, dept_admin_headers, db_factory):
    seed_tree_and_members(db_factory)
    resp = await client.get("/api/v1/terminal-roster?scope=team&limit=100", headers=dept_admin_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    ids = {row["owner_principal_id"] for row in data["items"]}
    # dept-a + team-a members visible; dept-b member excluded
    assert {"m-online", "m-offline", "m-pending", "m-naked"} <= ids
    assert "m-other" not in ids
    statuses = status_map(data["items"])
    assert statuses["m-online"] == "ONLINE"
    assert statuses["m-offline"] == "OFFLINE"
    assert statuses["m-pending"] == "PENDING"
    assert statuses["m-naked"] == "NOT_INSTALLED"


async def test_roster_row_exposes_trimmed_metadata(client: AsyncClient, dept_admin_headers, db_factory):
    seed_tree_and_members(db_factory)
    resp = await client.get("/api/v1/terminal-roster?scope=team&limit=100&q=在线", headers=dept_admin_headers)
    assert resp.status_code == 200
    row = next(r for r in resp.json()["items"] if r["owner_principal_id"] == "m-online")
    assert row["hostname"] == "online-host"
    # 024：单值 IP（平台观测）+ 单值主 MAC；已裁剪字段不再出现在 API
    assert row["ip_address"] == "203.0.113.11"
    assert row["mac_address"] == "aa:bb:cc:dd:ee:11"
    for removed in ("internal_ips", "mac_addresses", "public_ip", "os_version", "os_platform", "install_path"):
        assert removed not in row
    assert row["email"] == "online@example.com"


async def test_enrollment_snapshot_accepts_metadata(client: AsyncClient, employee_headers):
    _, public_jwk = create_es256_key_pair()
    payload = {
        "installation_id": str(uuid.uuid4()),
        "public_key": public_jwk,
        "display_name": "元数据终端",
        "workbench_version": "2.0.0",
        "os": "linux",
        "arch": "x64",
        "metadata": {
            "hostname": "my-laptop",
            "mac_address": "de:ad:be:ef:00:01",
        },
    }
    resp = await client.post("/api/v1/workbench-enrollments", headers=employee_headers, json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["hostname"] == "my-laptop"
    assert body["mac_address"] == "de:ad:be:ef:00:01"
    assert body["ip_address"]  # 接入提交即记录平台观测 IP


async def test_enrollment_without_metadata_still_succeeds(client: AsyncClient, employee_headers):
    _, public_jwk = create_es256_key_pair()
    payload = {
        "installation_id": str(uuid.uuid4()),
        "public_key": public_jwk,
        "display_name": "旧版终端",
        "workbench_version": "1.0.0",
        "os": "linux",
        "arch": "x64",
    }
    resp = await client.post("/api/v1/workbench-enrollments", headers=employee_headers, json=payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["hostname"] is None
