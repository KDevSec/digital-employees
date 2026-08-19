from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.orm import Session, sessionmaker

from app.auth.oidc import OidcClient
from app.auth.sessions import session_token_hash
from app.models import BffSession


@pytest.fixture
def fake_discovery(monkeypatch):
    async def _discovery(self: OidcClient) -> dict:
        return {
            "issuer": self.settings.oidc_issuer,
            "end_session_endpoint": f"{self.settings.oidc_issuer}/protocol/openid-connect/logout",
        }

    monkeypatch.setattr(OidcClient, "discovery", _discovery)


def _seed_session(db_factory: sessionmaker[Session], raw_token: str, id_token: str | None) -> str:
    with db_factory.begin() as session:
        session.add(
            BffSession(
                id_hash=session_token_hash(raw_token),
                principal_id="system-user",
                expires_at=datetime.now(UTC) + timedelta(hours=8),
                id_token=id_token,
            )
        )
    return raw_token


async def test_logout_redirects_to_keycloak_with_id_token_hint(
    client: AsyncClient, db_factory: sessionmaker[Session], system_headers: dict[str, str], fake_discovery
) -> None:
    raw = _seed_session(db_factory, "raw-token-xyz", "id-token-xyz")

    response = await client.get(
        "/auth/logout",
        headers=system_headers,
        cookies={"platform_session": raw},
    )

    assert response.status_code == 302
    location = response.headers["location"]
    assert "id_token_hint=id-token-xyz" in location
    assert "post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A18000%2F" in location
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw)) is None


async def test_logout_without_id_token_falls_back_home(
    client: AsyncClient, db_factory: sessionmaker[Session], system_headers: dict[str, str], fake_discovery
) -> None:
    raw = _seed_session(db_factory, "raw-token-legacy", None)

    response = await client.get(
        "/auth/logout",
        headers=system_headers,
        cookies={"platform_session": raw},
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/"
    with db_factory() as session:
        assert session.get(BffSession, session_token_hash(raw)) is None
