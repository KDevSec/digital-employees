import json
from pathlib import Path

import pytest


def _realm_doc() -> dict:
    candidate = Path(__file__).resolve().parent
    while candidate != candidate.parent:
        path = candidate / "iam" / "realm" / "digital-employees-realm.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        candidate = candidate.parent
    raise AssertionError("realm JSON not found above tests")


def test_iam_sync_service_account_can_view_groups() -> None:
    doc = _realm_doc()
    service_account = next(
        user for user in doc["users"] if user.get("serviceAccountClientId") == "platform-iam-sync"
    )
    roles = service_account["clientRoles"]["realm-management"]
    assert "view-groups" in roles, "platform-iam-sync needs view-groups to list the group tree"
    assert "query-groups" in roles


def test_platform_web_client_allows_post_logout_redirect() -> None:
    doc = _realm_doc()
    platform_web = next(client for client in doc["clients"] if client["clientId"] == "platform-web")
    # Keycloak 26 ClientRepresentation has no top-level postLogoutRedirectUris field;
    # the logout redirect URIs are stored in attributes["post.logout.redirect.uris"].
    assert "${PLATFORM_PUBLIC_URL}/" in platform_web["attributes"]["post.logout.redirect.uris"]


def test_platform_web_client_configures_backchannel_logout() -> None:
    doc = _realm_doc()
    platform_web = next(client for client in doc["clients"] if client["clientId"] == "platform-web")
    # Back-Channel Logout: Keycloak POSTs a logout_token to this URL when a session
    # ends (admin-forced logout / user logout / idle timeout) so the platform can
    # revoke the matching local BFF session.
    assert platform_web["attributes"]["backchannel.logout.url"] == (
        "${PLATFORM_INTERNAL_URL}/auth/backchannel-logout"
    )
