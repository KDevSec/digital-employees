import base64
import hashlib
import json
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec


class InvalidProof(ValueError):
    pass


def create_es256_key_pair() -> tuple[dict[str, str], dict[str, str]]:
    key = ec.generate_private_key(ec.SECP256R1())
    private_numbers = key.private_numbers()
    public_numbers = private_numbers.public_numbers

    def encoded(value: int) -> str:
        return base64.urlsafe_b64encode(value.to_bytes(32, "big")).rstrip(b"=").decode()

    public_jwk = {
        "kty": "EC",
        "crv": "P-256",
        "x": encoded(public_numbers.x),
        "y": encoded(public_numbers.y),
    }
    return {**public_jwk, "d": encoded(private_numbers.private_value)}, public_jwk


def jwk_thumbprint(jwk: dict[str, str]) -> str:
    try:
        canonical = json.dumps(
            {key: jwk[key] for key in ("crv", "kty", "x", "y")},
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
    except KeyError as exc:
        raise InvalidProof("invalid EC JWK") from exc
    return base64.urlsafe_b64encode(hashlib.sha256(canonical).digest()).rstrip(b"=").decode()


def sign_jwt(private_jwk: dict[str, str], claims: dict[str, Any]) -> str:
    try:
        key = jwt.PyJWK.from_dict(private_jwk, algorithm="ES256").key
        return jwt.encode(claims, key, algorithm="ES256", headers={"typ": "JWT"})
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise InvalidProof("could not sign proof") from exc


def verify_es256_jwt(
    token: str,
    public_jwk: dict[str, str],
    *,
    audience: str,
    issuer: str | None = None,
    subject: str | None = None,
) -> dict[str, Any]:
    try:
        key = jwt.PyJWK.from_dict(public_jwk, algorithm="ES256").key
        options = {
            "require": ["aud", "iat", "exp", "jti"],
            "verify_iss": issuer is not None,
            "verify_sub": subject is not None,
        }
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience=audience,
            issuer=issuer,
            options=options,
        )
        if subject is not None and claims.get("sub") != subject:
            raise InvalidProof("invalid ES256 proof subject")
        return claims
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise InvalidProof("invalid ES256 proof") from exc
