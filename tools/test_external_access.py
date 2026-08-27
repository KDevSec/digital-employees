import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PASSWORD = "Horse~test@2026"


def compose_config(public_host: str) -> dict:
    environment = {**os.environ, "PUBLIC_HOST": public_host}
    result = subprocess.run(
        [str(ROOT / "tools/compose.sh"), "config", "--format", "json"],
        cwd=ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def test_realm_uses_runtime_placeholders_and_no_hardcoded_users() -> None:
    realm = json.loads((ROOT / "iam/realm/digital-employees-realm.json").read_text())
    clients = {client["clientId"]: client for client in realm["clients"]}

    assert clients["platform-web"]["redirectUris"] == ["${PLATFORM_PUBLIC_URL}/auth/callback"]
    assert clients["platform-web"]["webOrigins"] == ["${PLATFORM_PUBLIC_URL}"]

    # Approach B: no demo users with credentials in realm JSON
    people = [user for user in realm["users"] if user.get("credentials")]
    assert not people
    # Only the IAM sync service account remains (no credentials)
    assert len(realm["users"]) == 1
    assert realm["users"][0]["username"] == "service-account-platform-iam-sync"


def test_sync_script_updates_post_logout_redirect_and_pkce_attributes() -> None:
    script = (ROOT / "tools/sync-keycloak-urls.sh").read_text()

    assert "post.logout.redirect.uris" in script
    assert "pkce.code.challenge.method" in script
    assert "update_client_urls platform-web" in script


def test_logout_redirect_uri_matches_sync_script_for_any_public_host() -> None:
    # Logout works only if Keycloak's platform-web attributes["post.logout.redirect.uris"]
    # equals the post_logout_redirect_uri the backend sends: f"{platform_base_url}/".
    # Both must derive from the same PUBLIC_HOST. This asserts the invariant generically,
    # without depending on how Keycloak is externally reached (host/port may differ per env).
    script = (ROOT / "tools/sync-keycloak-urls.sh").read_text()
    assert 'platform_url="http://$PUBLIC_HOST:18000"' in script
    assert '"$platform_url/"' in script  # 4th arg: post_logout_uri for platform-web

    for public_host in ("192.168.153.128", "10.23.45.67", "platform.example.com"):
        services = compose_config(public_host)["services"]
        platform_base = services["platform-api"]["environment"]["PLATFORM_PLATFORM_BASE_URL"]
        backend_post_logout = f"{platform_base}/"  # auth.py: post_logout_redirect_uri = {base}/
        sync_script_value = f"http://{public_host}:18000/"   # platform_url + "/"
        assert backend_post_logout == sync_script_value, (
            f"mismatch for {public_host}: backend={backend_post_logout} sync={sync_script_value}"
        )


def test_compose_derives_every_public_url_from_each_selected_host() -> None:
    for public_host in ("192.168.153.128", "10.23.45.67"):
        services = compose_config(public_host)["services"]
        keycloak = services["keycloak"]["environment"]
        platform = services["platform-api"]["environment"]

        assert keycloak["KC_HOSTNAME"] == f"http://{public_host}:18080"
        assert keycloak["PLATFORM_PUBLIC_URL"] == f"http://{public_host}:18000"
        assert platform["PLATFORM_PLATFORM_BASE_URL"] == f"http://{public_host}:18000"
        assert platform["PLATFORM_OIDC_ISSUER"] == (
            f"http://{public_host}:18080/realms/digital-employees"
        )


def test_runtime_env_prefers_explicit_host_then_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / "runtime.env"
    env_file.write_text("PUBLIC_HOST=10.20.30.40\n")
    command = '. tools/runtime-env.sh; printf "%s" "$PUBLIC_HOST"'

    from_file = subprocess.run(
        ["sh", "-c", command],
        cwd=ROOT,
        env={**os.environ, "PUBLIC_HOST": "", "RUNTIME_ENV_FILE": str(env_file), "tools_dir": str(ROOT / "tools")},
        check=True,
        capture_output=True,
        text=True,
    )
    explicit = subprocess.run(
        ["sh", "-c", command],
        cwd=ROOT,
        env={**os.environ, "PUBLIC_HOST": "172.16.4.9", "RUNTIME_ENV_FILE": str(env_file), "tools_dir": str(ROOT / "tools")},
        check=True,
        capture_output=True,
        text=True,
    )

    assert from_file.stdout == "10.20.30.40"
    assert explicit.stdout == "172.16.4.9"


def test_browser_test_uses_runtime_host_without_fixed_deployment_ip() -> None:
    e2e = (ROOT / "tools/e2e/v01.spec.ts").read_text()

    assert "process.env.PUBLIC_HOST" in e2e
    assert DEFAULT_PASSWORD in e2e
    assert "192.168.153.128" not in e2e


def test_oidc_callback_authorization_code_is_not_written_to_nginx_access_log() -> None:
    nginx = (ROOT / "platform/frontend/nginx.conf").read_text()

    callback = nginx.index("location = /auth/callback")
    general_auth = nginx.index("location /auth/")
    assert callback < general_auth
    assert "access_log off;" in nginx[callback:general_auth]


def test_sync_script_configures_backchannel_logout_url() -> None:
    script = (ROOT / "tools/sync-keycloak-urls.sh").read_text()
    assert "backchannel.logout.url" in script
    # The back-channel URL is server-to-server (Keycloak -> platform); use the
    # docker-internal service address so it works even when PUBLIC_HOST=127.0.0.1.
    assert "${PLATFORM_INTERNAL_URL}/auth/backchannel-logout" in script


def test_compose_keycloak_has_platform_internal_url() -> None:
    for public_host in ("192.168.153.128", "127.0.0.1"):
        services = compose_config(public_host)["services"]
        assert services["keycloak"]["environment"]["PLATFORM_INTERNAL_URL"] == "http://platform-api:8000"
