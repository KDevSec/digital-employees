"""RED tests for 015-user-management-refactor.

Covers: list does not trigger sync_directory, aggregated detail endpoint,
role_code filter semantics, scope-options caching, synchronous iam/sync with counts,
overview removal.
"""
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import Request
from httpx import ASGITransport, AsyncClient

import app.api.custom_roles as custom_roles_module
from app.api.dependencies import AuthenticatedPrincipal
from app.config import Settings
from app.database import get_session
from app.domain.authorization import RoleCode, ScopeType
from app.main import create_app
from app.models import (
    CustomRole,
    IamPrincipal,
    RoleAssignment,
    ScopedRoleAssignment,
)


@pytest_asyncio.fixture
async def client_no_sync(db_factory, tmp_path: Path):
    """testing=False client; sync_directory stubbed to count calls, no lifespan (no bg task)."""
    settings = Settings(
        database_url="sqlite+pysqlite://",
        package_storage_path=tmp_path / "packages",
        platform_base_url="http://localhost:18000",
        oidc_issuer="https://iam.test/realms/digital",
        oidc_client_id="platform-web",
        oidc_client_secret="test-secret",
        session_secret="test-session-secret-with-at-least-32-characters",
        machine_signing_secret="test-machine-secret-with-at-least-32-characters",
        testing=False,
    )
    settings.package_storage_path.mkdir(parents=True, exist_ok=True)
    app = create_app(settings, audit_session_factory=db_factory)
    app.state.audit_session_factory = db_factory

    async def session_override():
        with db_factory() as session:
            yield session

    def identity_override(request: Request) -> AuthenticatedPrincipal:
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        principal_id = {"test-system": "system-user"}.get(token)
        if not principal_id:
            from app.errors import ApiError

            raise ApiError(401, "PERSON_SESSION_INVALID", "Authentication required")
        with db_factory() as session:
            return AuthenticatedPrincipal.load(session, principal_id)

    app.dependency_overrides[get_session] = session_override
    app.state.identity_override = identity_override

    calls = {"count": 0}

    async def counting_sync(session, *, force=False):
        calls["count"] += 1
        return {"principals_synced": 0, "principals_disabled": 0, "org_nodes_synced": 0}

    app.state.oidc.sync_directory = counting_sync

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c:
        c.sync_calls = calls
        yield c


async def test_list_does_not_trigger_sync_directory(client_no_sync, system_headers):
    resp = await client_no_sync.get("/api/v1/iam/principals?offset=0&limit=20", headers=system_headers)
    assert resp.status_code == 200, resp.text
    assert client_no_sync.sync_calls["count"] == 0, "list request must not trigger sync_directory"


async def test_principal_detail_aggregates_sections(client, system_headers, db_factory):
    with db_factory() as session:
        session.add(IamPrincipal(
            id="detail-user", issuer="https://iam.test/realms/digital",
            subject="sub-detail", username="detailuser", display_name="Detail User",
            email="detail@test.com", domain_id="domain-a", department_id="dept-a",
            primary_org_id="domain-a", status="ACTIVE",
        ))
        session.add(RoleAssignment(
            id="ra-detail", principal_id="detail-user",
            role_code=RoleCode.DEPARTMENT_ADMIN, scope_type=ScopeType.ALL_DEPARTMENTS,
            domain_id="domain-a", status="ACTIVE", created_by="bootstrap",
        ))
        session.add(CustomRole(
            id="cr-detail", domain_id="domain-a", code="custom-detail",
            name="Custom Detail Role", status="ACTIVE", created_by="bootstrap",
        ))
        session.add(ScopedRoleAssignment(
            id="sra-detail", role_id="cr-detail", subject_type="PRINCIPAL",
            subject_id="detail-user", scope_org_id="domain-a",
            scope_include_descendants=True, status="ACTIVE", created_by="bootstrap",
        ))
        session.commit()

    resp = await client.get("/api/v1/principals/detail-user/detail", headers=system_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["identity"]["username"] == "detailuser"
    assert data["identity"]["email"] == "detail@test.com"
    assert data["identity"]["status"] == "ACTIVE"
    assert "synced_at" in data["identity"]
    assert any(a["role_code"] == "DEPARTMENT_ADMIN" for a in data["authorizations"]["fixed_assignments"])
    assert any(g["role_name"] == "Custom Detail Role" for g in data["authorizations"]["scoped_grants"])
    assert data["org_context"] is not None


async def test_principal_detail_not_found(client, system_headers):
    resp = await client.get("/api/v1/principals/nonexistent-id/detail", headers=system_headers)
    assert resp.status_code == 404
    assert "PRINCIPAL_NOT_FOUND" in resp.text


async def test_principal_detail_empty_authorizations(client, system_headers, db_factory):
    with db_factory() as session:
        session.add(IamPrincipal(
            id="empty-auth-user", issuer="https://iam.test/realms/digital",
            subject="sub-empty", username="emptyauth", display_name="Empty Auth",
            domain_id="domain-a", department_id="dept-a", status="ACTIVE",
        ))
        session.commit()
    resp = await client.get("/api/v1/principals/empty-auth-user/detail", headers=system_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["authorizations"]["fixed_assignments"] == []
    assert data["authorizations"]["scoped_grants"] == []


async def test_principals_filter_by_role_returns_only_matching(client, system_headers):
    # system-user holds SYSTEM_ADMIN (seeded); employee-user does not.
    resp = await client.get("/api/v1/iam/principals?role_code=SYSTEM_ADMIN", headers=system_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert items, "expected at least one SYSTEM_ADMIN"
    assert all("SYSTEM_ADMIN" in i["roles"] for i in items)
    assert any(i["username"] == "system" for i in items)


async def test_scope_options_cached(client, system_headers, monkeypatch):
    monkeypatch.setattr(custom_roles_module, "_scope_options_cache", None, raising=False)
    resp1 = await client.get("/api/v1/authorization/scope-options", headers=system_headers)
    assert resp1.status_code == 200, resp1.text
    cache_after = getattr(custom_roles_module, "_scope_options_cache", None)
    assert cache_after is not None, "cache should be populated after first request"
    resp2 = await client.get("/api/v1/authorization/scope-options", headers=system_headers)
    assert resp2.status_code == 200
    assert resp2.json() == resp1.json()
    assert custom_roles_module._scope_options_cache is cache_after, "second request must hit cache"


async def test_iam_sync_runs_synchronously_and_returns_counts(client_no_sync, system_headers):
    resp = await client_no_sync.post("/api/v1/iam/sync", headers=system_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "SYNCED"
    assert body["principals_synced"] == 0
    assert body["org_nodes_synced"] == 0
    assert client_no_sync.sync_calls["count"] == 1, "endpoint must run the sync inline"


async def test_overview_removed(client, system_headers):
    resp = await client.get("/api/v1/authorization/overview", headers=system_headers)
    assert resp.status_code == 404
