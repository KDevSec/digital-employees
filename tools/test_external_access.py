import json
import os
import re
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

    # workbench-desktop runs on each end user's own machine: OAuth redirect is a
    # browser jump to the user's own loopback, so URIs are fixed 127.0.0.1/localhost
    # values (workbench default port 19980) and must not derive from PUBLIC_HOST.
    wb = clients["workbench-desktop"]
    assert wb["redirectUris"] == [
        "http://127.0.0.1:19980/auth/callback",
        "http://localhost:19980/auth/callback",
    ]
    assert wb["webOrigins"] == ["http://127.0.0.1:19980", "http://localhost:19980"]
    assert "${WORKBENCH_PUBLIC_URL}" not in json.dumps(realm)


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
    assert 'platform_url="https://$PUBLIC_HOST:18000"' in script
    assert '"$platform_url/"' in script  # 4th arg: post_logout_uri for platform-web

    for public_host in ("192.168.153.128", "10.23.45.67", "platform.example.com"):
        services = compose_config(public_host)["services"]
        platform_base = services["platform-api"]["environment"]["PLATFORM_PLATFORM_BASE_URL"]
        backend_post_logout = f"{platform_base}/"  # auth.py: post_logout_redirect_uri = {base}/
        sync_script_value = f"https://{public_host}:18000/"   # platform_url + "/"
        assert backend_post_logout == sync_script_value, (
            f"mismatch for {public_host}: backend={backend_post_logout} sync={sync_script_value}"
        )


def test_compose_derives_every_public_url_from_each_selected_host() -> None:
    for public_host in ("192.168.153.128", "10.23.45.67"):
        services = compose_config(public_host)["services"]
        keycloak = services["keycloak"]["environment"]
        platform = services["platform-api"]["environment"]

        assert keycloak["KC_HOSTNAME"] == f"https://{public_host}:18080"
        assert keycloak["PLATFORM_PUBLIC_URL"] == f"https://{public_host}:18000"
        assert platform["PLATFORM_PLATFORM_BASE_URL"] == f"https://{public_host}:18000"
        assert platform["PLATFORM_OIDC_ISSUER"] == (
            f"https://{public_host}:18080/realms/digital-employees"
        )
        assert platform["PLATFORM_OIDC_ADMIN_URL"] == f"https://{public_host}:18080"
        # Container-internal traffic stays plain HTTP; internal OIDC discovery/token
        # exchange must not depend on trusting the self-signed certificate.
        assert platform["PLATFORM_OIDC_INTERNAL_ISSUER"] == (
            "http://keycloak:8080/realms/digital-employees"
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
    # Workbench runs on the test host itself: loopback + default port 19980.
    assert "`http://127.0.0.1:19980`" in e2e


def test_oidc_callback_authorization_code_is_not_written_to_nginx_access_log() -> None:
    nginx = (ROOT / "platform/frontend/nginx.conf").read_text()

    callback = nginx.index("location = /auth/callback")
    general_auth = nginx.index("location /auth/")
    assert callback < general_auth
    assert "access_log off;" in nginx[callback:general_auth]


def test_sync_script_corrects_workbench_desktop_loopback_uris() -> None:
    script = (ROOT / "tools/sync-keycloak-urls.sh").read_text()
    assert "clientId=workbench-desktop" in script
    assert "http://127.0.0.1:19980/auth/callback" in script
    assert "http://localhost:19980/auth/callback" in script
    # Must be fixed loopback values, never derived from the server host.
    assert "WORKBENCH_PUBLIC_URL" not in script


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


def _published_ports(service: dict) -> set[tuple[int, int]]:
    pairs = set()
    for port in service.get("ports", []):
        if isinstance(port, dict):
            pairs.add((int(port["target"]), int(port["published"])))
        else:
            published, target = str(port).split(":")
            pairs.add((int(target), int(published)))
    return pairs


def _mount_targets(service: dict) -> set[str]:
    return {v.get("target", "") for v in service.get("volumes", [])}


def test_compose_publishes_https_ports_and_mounts_certs() -> None:
    services = compose_config("192.168.153.128")["services"]

    assert (8443, 18080) in _published_ports(services["keycloak"])
    assert (8080, 18080) not in _published_ports(services["keycloak"])
    assert (443, 18000) in _published_ports(services["platform-web"])
    assert (80, 18000) not in _published_ports(services["platform-web"])

    keycloak_env = services["keycloak"]["environment"]
    assert keycloak_env["KC_HTTPS_CERTIFICATE_FILE"] == "/opt/keycloak/conf/certs/server.crt"
    assert keycloak_env["KC_HTTPS_CERTIFICATE_KEY_FILE"] == "/opt/keycloak/conf/certs/server.key"

    assert "/opt/keycloak/conf/certs" in _mount_targets(services["keycloak"])
    assert "/etc/nginx/certs" in _mount_targets(services["platform-web"])


def test_nginx_serves_tls_443_with_mounted_certs() -> None:
    nginx = (ROOT / "platform/frontend/nginx.conf").read_text()

    assert "listen 443 ssl;" in nginx
    assert "ssl_certificate /etc/nginx/certs/server.crt;" in nginx
    assert "ssl_certificate_key /etc/nginx/certs/server.key;" in nginx
    assert "listen 80" not in nginx


def test_up_script_generates_certs_and_waits_on_https() -> None:
    up = (ROOT / "tools/up.sh").read_text()
    wait = (ROOT / "tools/wait-for-http.sh").read_text()

    assert "ensure-certs.sh" in up
    assert "https://localhost:18080/realms/digital-employees/.well-known/openid-configuration" in up
    assert "https://localhost:18000/health/live" in up
    assert 'echo "Management platform: https://$PUBLIC_HOST:18000"' in up
    assert 'echo "Keycloak: https://$PUBLIC_HOST:18080"' in up
    # Self-signed certs are not system-trusted; readiness probes must skip verification.
    assert "--insecure" in wait


def test_cert_generation_is_idempotent_and_tracks_public_host(tmp_path: Path) -> None:
    def run_ensure(public_host: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["sh", str(ROOT / "tools/ensure-certs.sh")],
            cwd=ROOT,
            env={**os.environ, "PUBLIC_HOST": public_host, "CERT_DIR": str(tmp_path)},
            check=True,
            capture_output=True,
            text=True,
        )

    def san() -> str:
        result = subprocess.run(
            ["openssl", "x509", "-in", str(tmp_path / "server.crt"), "-noout", "-ext", "subjectAltName"],
            check=True, capture_output=True, text=True,
        )
        return result.stdout

    run_ensure("192.168.153.128")
    for name in ("ca.crt", "ca.key", "server.crt", "server.key"):
        assert (tmp_path / name).exists()
    # Keycloak runs as a non-root user in-container; mounted private keys must be
    # world-readable locally (dev-only self-signed material).
    assert (tmp_path / "server.key").stat().st_mode & 0o777 == 0o644
    assert (tmp_path / "ca.key").stat().st_mode & 0o777 == 0o644
    san_ip = san()
    assert "IP Address:192.168.153.128" in san_ip
    assert "IP Address:127.0.0.1" in san_ip
    assert "DNS:localhost" in san_ip

    # Idempotent: re-running with the same host must not re-issue anything.
    ca_before = (tmp_path / "ca.crt").read_bytes()
    server_before = (tmp_path / "server.crt").read_bytes()
    run_ensure("192.168.153.128")
    assert (tmp_path / "ca.crt").read_bytes() == ca_before
    assert (tmp_path / "server.crt").read_bytes() == server_before

    # Host change (IP -> DNS name): leaf cert re-issued with the new SAN, CA reused.
    run_ensure("platform.example.com")
    san_dns = san()
    assert "DNS:platform.example.com" in san_dns
    assert "IP Address:192.168.153.128" not in san_dns
    assert (tmp_path / "ca.crt").read_bytes() == ca_before
    assert (tmp_path / "server.crt").read_bytes() != server_before

    # The leaf cert is signed by the local CA.
    verify = subprocess.run(
        ["openssl", "verify", "-CAfile", str(tmp_path / "ca.crt"), str(tmp_path / "server.crt")],
        capture_output=True, text=True,
    )
    assert verify.returncode == 0, verify.stdout + verify.stderr


def test_cert_dir_is_gitignored() -> None:
    gitignore = (ROOT / ".gitignore").read_text()
    assert "tools/certs/" in gitignore


def test_e2e_uses_https_and_ignores_self_signed_cert_errors() -> None:
    e2e = (ROOT / "tools/e2e/v01.spec.ts").read_text()
    assert "https://${publicHost}:18000" in e2e

    playwright_config = (ROOT / "tools/playwright.config.ts").read_text()
    assert "ignoreHTTPSErrors" in playwright_config


def test_every_realm_placeholder_is_injected_into_keycloak_env() -> None:
    # An unsubstituted ${VAR} in a client URL makes Keycloak reject the realm
    # import ("A redirect URI is not a valid URI") on a fresh database volume.
    realm = (ROOT / "iam/realm/digital-employees-realm.json").read_text()
    placeholders = set(re.findall(r"\$\{([A-Z0-9_]+)\}", realm))
    keycloak_env = compose_config("192.168.153.128")["services"]["keycloak"]["environment"]

    assert placeholders <= set(keycloak_env), (
        f"realm placeholders missing from keycloak env: {sorted(placeholders - set(keycloak_env))}"
    )
    assert "WORKBENCH_PUBLIC_URL" not in keycloak_env


def test_keycloak_runs_in_production_mode() -> None:
    services = compose_config("192.168.153.128")["services"]
    command = services["keycloak"]["command"]
    assert "start-dev" not in command
    assert "start" in command
    # Realm import on startup is still used to bootstrap fresh deployments.
    assert "--import-realm" in command
    # Internal container traffic stays HTTP; TLS is provided by Keycloak itself.
    assert services["keycloak"]["environment"]["KC_HTTPS_CERTIFICATE_FILE"]


def test_backend_runs_four_uvicorn_workers() -> None:
    entrypoint = (ROOT / "platform/backend/entrypoint.sh").read_text()
    assert "--workers 4" in entrypoint


def test_backend_db_pool_sized_for_four_workers_under_postgres_limit() -> None:
    # 4 uvicorn workers each open their own pool; total must stay well under the
    # Postgres default max_connections=100 (Keycloak needs connections too).
    services = compose_config("192.168.153.128")["services"]
    env = services["platform-api"]["environment"]
    pool = int(env.get("PLATFORM_DB_POOL_SIZE", "20"))
    overflow = int(env.get("PLATFORM_DB_MAX_OVERFLOW", "10"))
    assert (pool + overflow) * 4 < 100
