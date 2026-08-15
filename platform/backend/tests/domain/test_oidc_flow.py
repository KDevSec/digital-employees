import pytest

from app.auth.oidc import InvalidOidcFlow, OidcFlow, OidcFlowCodec


def test_oidc_flow_cookie_round_trips_without_exposing_client_secret() -> None:
    codec = OidcFlowCodec("a-secure-test-secret-that-is-long-enough")
    flow = OidcFlow(
        state="state-value",
        nonce="nonce-value",
        code_verifier="verifier-value",
        return_to="/workbenches",
    )

    encoded = codec.encode(flow)
    decoded = codec.decode(encoded, max_age_seconds=300)

    assert decoded == flow
    assert "client_secret" not in encoded


def test_tampered_oidc_flow_cookie_is_rejected() -> None:
    codec = OidcFlowCodec("a-secure-test-secret-that-is-long-enough")
    encoded = codec.encode(OidcFlow("state", "nonce", "verifier", "/"))

    with pytest.raises(InvalidOidcFlow):
        codec.decode(encoded + "tampered", max_age_seconds=300)
