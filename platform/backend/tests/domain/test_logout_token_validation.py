import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.oidc import OidcClient
from app.config import Settings
from app.errors import ApiError

ISSUER = "https://iam.test/realms/digital"
CLIENT_ID = "platform-web"
EVENT = "http://schemas.openid.net/event/backchannel-logout"


def _settings() -> Settings:
    return Settings(
        testing=True,
        oidc_issuer=ISSUER,
        oidc_client_id=CLIENT_ID,
        oidc_client_secret="test-secret",
        session_secret="test-session-secret-with-at-least-32-characters",
        machine_signing_secret="test-machine-secret-with-at-least-32-characters",
    )


def _make_keys() -> tuple[object, dict]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = pyjwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk["kid"] = "test-kid"
    return private_key, jwk


def _client(jwk: dict) -> OidcClient:
    client = OidcClient(_settings())
    client._jwks = {"keys": [jwk]}
    return client


def _token(private_key: object, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "iat": now,
        "exp": now + 60,
        "jti": f"jti-{now}",
        "events": {EVENT: {}},
    }
    claims.update(overrides)
    return pyjwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-kid"})


async def test_valid_logout_token_with_sid_returns_claims() -> None:
    private_key, jwk = _make_keys()
    client = _client(jwk)
    claims = await client.validate_logout_token(
        _token(private_key, sub="sub-1", sid="sess-1")
    )
    assert claims["sid"] == "sess-1"
    assert claims["sub"] == "sub-1"


async def test_valid_logout_token_with_sub_only_returns_claims() -> None:
    private_key, jwk = _make_keys()
    client = _client(jwk)
    claims = await client.validate_logout_token(_token(private_key, sub="sub-1"))
    assert claims["sub"] == "sub-1"


@pytest.mark.parametrize(
    "make",
    [
        lambda pk, jwk: _token(_make_keys()[0], sub="sub-1", sid="s1"),  # bad signature
        lambda pk, jwk: _token(pk, iss="https://other/realms/x", sub="sub-1", sid="s1"),
        lambda pk, jwk: _token(pk, aud="other-client", sub="sub-1", sid="s1"),
        lambda pk, jwk: _token(pk, sub="sub-1", sid="s1", events=None),  # missing events
        lambda pk, jwk: _token(pk, sub="sub-1", sid="s1", nonce="x"),  # nonce forbidden
    ],
)
async def test_invalid_logout_token_rejected(make) -> None:
    private_key, jwk = _make_keys()
    client = _client(jwk)
    with pytest.raises(ApiError) as exc:
        await client.validate_logout_token(make(private_key, jwk))
    assert exc.value.status_code == 401


async def test_logout_token_without_sub_or_sid_rejected() -> None:
    private_key, jwk = _make_keys()
    client = _client(jwk)
    with pytest.raises(ApiError) as exc:
        await client.validate_logout_token(_token(private_key))
    assert exc.value.status_code == 401


async def test_logout_token_replay_rejected() -> None:
    private_key, jwk = _make_keys()
    client = _client(jwk)
    first = _token(private_key, sub="sub-1", sid="s1", jti="dup-jti")
    await client.validate_logout_token(first)
    second = _token(private_key, sub="sub-1", sid="s1", jti="dup-jti")
    with pytest.raises(ApiError) as exc:
        await client.validate_logout_token(second)
    assert exc.value.status_code == 401
