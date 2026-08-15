from datetime import UTC, datetime, timedelta

import pytest

from app.domain.crypto import (
    InvalidProof,
    create_es256_key_pair,
    jwk_thumbprint,
    sign_jwt,
    verify_es256_jwt,
)


def test_thumbprint_is_stable_and_does_not_include_private_material() -> None:
    private_jwk, public_jwk = create_es256_key_pair()

    assert jwk_thumbprint(private_jwk) == jwk_thumbprint(public_jwk)
    assert "d" not in public_jwk


def test_es256_proof_verifies_required_claims() -> None:
    private_jwk, public_jwk = create_es256_key_pair()
    now = datetime.now(UTC)
    token = sign_jwt(
        private_jwk,
        {
            "iss": "workbench-1",
            "sub": "workbench-1",
            "aud": "https://platform.test/oauth2/workbench/token",
            "iat": now,
            "exp": now + timedelta(minutes=1),
            "jti": "unique-jti",
        },
    )

    claims = verify_es256_jwt(
        token,
        public_jwk,
        audience="https://platform.test/oauth2/workbench/token",
        issuer="workbench-1",
        subject="workbench-1",
    )

    assert claims["jti"] == "unique-jti"


def test_proof_signed_by_another_key_is_rejected() -> None:
    attacker_private, _ = create_es256_key_pair()
    _, registered_public = create_es256_key_pair()
    now = datetime.now(UTC)
    token = sign_jwt(
        attacker_private,
        {"aud": "expected", "iat": now, "exp": now + timedelta(minutes=1), "jti": "jti"},
    )

    with pytest.raises(InvalidProof):
        verify_es256_jwt(token, registered_public, audience="expected")
