import time
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.oidc import OidcClient
from app.auth.sessions import session_token_hash
from app.errors import ApiError
from app.models import BffSession

ISSUER = "https://iam.test/realms/digital"


@pytest.fixture
def fake_discovery(monkeypatch):
    async def _discovery(self: OidcClient) -> dict:
        return {
            "issuer": self.settings.oidc_issuer,
            "authorization_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/auth",
            "token_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/token",
            "jwks_uri": f"{self.settings.oidc_issuer}/protocol/openid-connect/certs",
            "end_session_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/logout",
        }

    monkeypatch.setattr(OidcClient, "discovery", _discovery)


def _seed(
    db_factory: sessionmaker[Session],
    *,
    raw: str = "raw-1",
    sid: str | None = "sess-1",
    principal_id: str = "system-user",
    id_token: str | None = "id-1",
) -> str:
    with db_factory.begin() as session:
        session.add(
            BffSession(
                id_hash=session_token_hash(raw),
                principal_id=principal_id,
                expires_at=datetime.now(UTC) + timedelta(hours=8),
                id_token=id_token,
                sid=sid,
            )
        )
    return raw


def _stub_validation(monkeypatch, claims: dict) -> None:
    async def _validate(self: OidcClient, token: str) -> dict:
        return claims

    monkeypatch.setattr(OidcClient, "validate_logout_token", _validate)


def _stub_validation_error(monkeypatch) -> None:
    async def _validate(self: OidcClient, token: str) -> dict:
        raise ApiError(401, "PERSON_SESSION_INVALID", "bad token")

    monkeypatch.setattr(OidcClient, "validate_logout_token", _validate)


async def test_backchannel_logout_deletes_session_by_sid(
    client: AsyncClient, db_factory: sessionmaker[Session], fake_discovery, monkeypatch
) -> None:
    raw = _seed(db_factory, raw="raw-a", sid="sess-a")
    _stub_validation(monkeypatch, {"iss": ISSUER, "sub": "sub-system", "sid": "sess-a"})

    response = await client.post("/auth/backchannel-logout", data={"logout_token": "x"})

    assert response.status_code == 200
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw)) is None


async def test_backchannel_logout_isolates_sessions_by_sid(
    client: AsyncClient, db_factory: sessionmaker[Session], fake_discovery, monkeypatch
) -> None:
    raw_a = _seed(db_factory, raw="raw-a", sid="sess-a")
    raw_b = _seed(db_factory, raw="raw-b", sid="sess-b")
    _stub_validation(monkeypatch, {"iss": ISSUER, "sub": "sub-system", "sid": "sess-a"})

    response = await client.post("/auth/backchannel-logout", data={"logout_token": "x"})

    assert response.status_code == 200
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw_a)) is None
        assert session.get(BffSession, session_token_hash(raw_b)) is not None


async def test_backchannel_logout_falls_back_to_sub(
    client: AsyncClient, db_factory: sessionmaker[Session], fake_discovery, monkeypatch
) -> None:
    # Historical session has no sid; principal.subject == "sub-system" (conftest system-user).
    raw = _seed(db_factory, raw="raw-legacy", sid=None)
    _stub_validation(monkeypatch, {"iss": ISSUER, "sub": "sub-system"})

    response = await client.post("/auth/backchannel-logout", data={"logout_token": "x"})

    assert response.status_code == 200
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw)) is None


async def test_backchannel_logout_invalid_token_returns_401(
    client: AsyncClient, db_factory: sessionmaker[Session], fake_discovery, monkeypatch
) -> None:
    raw = _seed(db_factory, raw="raw-keep", sid="sess-keep")
    _stub_validation_error(monkeypatch)

    response = await client.post("/auth/backchannel-logout", data={"logout_token": "x"})

    assert response.status_code == 401
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw)) is not None


async def test_callback_stores_sid_from_id_token(
    client: AsyncClient, db_factory: sessionmaker[Session], monkeypatch
) -> None:
    async def _exchange(self: OidcClient, code: str, redirect_uri: str, verifier: str) -> dict:
        return {"id_token": "id-token-xyz", "access_token": "at"}

    monkeypatch.setattr(OidcClient, "exchange_code", _exchange)

    async def _validate(self: OidcClient, token: str, *, nonce: str | None = None) -> dict:
        now = int(time.time())
        return {
            "iss": self.settings.oidc_issuer,
            "sub": "sub-callback",
            "aud": self.settings.oidc_client_id,
            "iat": now,
            "exp": now + 300,
            "nonce": nonce,
            "preferred_username": "employee",
            "name": "Employee",
            "domain_id": "domain-a",
            "department_id": "dept-a",
            "sid": "kc-session-abc",
        }

    monkeypatch.setattr(OidcClient, "validate_token", _validate)

    async def _discovery(self: OidcClient) -> dict:
        return {
            "issuer": self.settings.oidc_issuer,
            "authorization_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/auth",
            "token_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/token",
            "jwks_uri": f"{self.settings.oidc_issuer}/protocol/openid-connect/certs",
            "end_session_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/logout",
        }

    monkeypatch.setattr(OidcClient, "discovery", _discovery)

    login = await client.get("/auth/login?return_to=/app/overview", follow_redirects=False)
    assert login.status_code == 302
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]

    callback = await client.get(
        "/auth/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )

    assert callback.status_code == 302
    assert callback.headers["location"] == "/app/overview"
    with db_factory() as session:
        rows = session.scalars(select(BffSession)).all()
        assert len(rows) == 1
        assert rows[0].sid == "kc-session-abc"
        assert rows[0].id_token == "id-token-xyz"
