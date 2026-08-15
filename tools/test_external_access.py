import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_HOST = "192.168.153.128"
DEFAULT_PASSWORD = "Horse~test@2026"


def test_realm_uses_physical_browser_addresses_and_strong_passwords() -> None:
    realm = json.loads((ROOT / "iam/realm/digital-employees-realm.json").read_text())
    clients = {client["clientId"]: client for client in realm["clients"]}

    assert clients["platform-web"]["redirectUris"] == [f"http://{PUBLIC_HOST}:18000/auth/callback"]
    assert clients["platform-web"]["webOrigins"] == [f"http://{PUBLIC_HOST}:18000"]
    assert clients["workbench-desktop"]["redirectUris"] == [f"http://{PUBLIC_HOST}:19820/auth/callback"]
    assert clients["workbench-desktop"]["webOrigins"] == [f"http://{PUBLIC_HOST}:19820"]

    people = [user for user in realm["users"] if user.get("credentials")]
    assert people
    assert {credential["value"] for user in people for credential in user["credentials"]} == {
        DEFAULT_PASSWORD
    }


def test_compose_and_browser_links_use_the_vm_address() -> None:
    compose = (ROOT / "tools/compose.yml").read_text()
    e2e = (ROOT / "tools/e2e/v01.spec.ts").read_text()
    workbench_ui = (ROOT / "workbench/src/ui.ts").read_text()

    for required in (
        f"KC_HOSTNAME: http://{PUBLIC_HOST}:18080",
        f"KC_BOOTSTRAP_ADMIN_PASSWORD: {DEFAULT_PASSWORD}",
        f"PLATFORM_PLATFORM_BASE_URL: http://{PUBLIC_HOST}:18000",
        f"PLATFORM_WORKBENCH_BASE_URL: http://{PUBLIC_HOST}:19820",
        f"PLATFORM_OIDC_ISSUER: http://{PUBLIC_HOST}:18080/realms/digital-employees",
        f"WORKBENCH_PUBLIC_URL: http://{PUBLIC_HOST}:19820",
        f"PLATFORM_PUBLIC_URL: http://{PUBLIC_HOST}:18000",
    ):
        assert required in compose

    assert f"http://{PUBLIC_HOST}:18000" in e2e
    assert f"http://{PUBLIC_HOST}:19820" in e2e
    assert DEFAULT_PASSWORD in e2e
    assert "http://localhost" not in e2e
    assert "http://localhost" not in workbench_ui
