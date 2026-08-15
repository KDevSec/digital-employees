from datetime import UTC, datetime, timedelta

from app.auth.sessions import new_session_token, session_token_hash


def test_session_token_is_opaque_random_and_only_hash_is_stored() -> None:
    first = new_session_token()
    second = new_session_token()

    assert first != second
    assert len(first) >= 43
    assert session_token_hash(first) != first
    assert session_token_hash(first) == session_token_hash(first)
