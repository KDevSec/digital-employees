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


def test_realm_uses_runtime_placeholders_and_strong_passwords() -> None:
    realm = json.loads((ROOT / "iam/realm/digital-employees-realm.json").read_text())
    clients = {client["clientId"]: client for client in realm["clients"]}

    assert clients["platform-web"]["redirectUris"] == ["${PLATFORM_PUBLIC_URL}/auth/callback"]
    assert clients["platform-web"]["webOrigins"] == ["${PLATFORM_PUBLIC_URL}"]
    assert clients["workbench-desktop"]["redirectUris"] == ["${WORKBENCH_PUBLIC_URL}/auth/callback"]
    assert clients["workbench-desktop"]["webOrigins"] == ["${WORKBENCH_PUBLIC_URL}"]

    people = [user for user in realm["users"] if user.get("credentials")]
    assert people
    assert {credential["value"] for user in people for credential in user["credentials"]} == {
        DEFAULT_PASSWORD
    }


def test_compose_derives_every_public_url_from_each_selected_host() -> None:
    for public_host in ("192.168.153.128", "10.23.45.67"):
        services = compose_config(public_host)["services"]
        keycloak = services["keycloak"]["environment"]
        platform = services["platform-api"]["environment"]
        workbench = services["workbench"]["environment"]

        assert keycloak["KC_HOSTNAME"] == f"http://{public_host}:18080"
        assert keycloak["PLATFORM_PUBLIC_URL"] == f"http://{public_host}:18000"
        assert keycloak["WORKBENCH_PUBLIC_URL"] == f"http://{public_host}:19820"
        assert platform["PLATFORM_PLATFORM_BASE_URL"] == f"http://{public_host}:18000"
        assert platform["PLATFORM_WORKBENCH_BASE_URL"] == f"http://{public_host}:19820"
        assert platform["PLATFORM_OIDC_ISSUER"] == (
            f"http://{public_host}:18080/realms/digital-employees"
        )
        assert workbench["WORKBENCH_PUBLIC_URL"] == f"http://{public_host}:19820"
        assert workbench["PLATFORM_PUBLIC_URL"] == f"http://{public_host}:18000"


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
