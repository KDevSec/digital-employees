import importlib.util
from pathlib import Path

from app.domain.authorization import ROLE_PERMISSIONS


def _load_permissions(module_file: str) -> set[str]:
    root = Path(__file__).resolve().parents[2]
    path = root / "app" / "migrations" / "versions" / module_file
    spec = importlib.util.spec_from_file_location(module_file.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {row[0] for row in module.PERMISSIONS}


def test_permission_catalog_covers_builtin_role_permissions() -> None:
    catalog = _load_permissions("0002_organization_permissions.py") | _load_permissions(
        "0004_iam_permission_ux_fixes.py"
    ) | _load_permissions("0006_audit_logging_permissions.py")
    builtin = set().union(*ROLE_PERMISSIONS.values())
    missing = builtin - catalog
    assert not missing, f"permission catalog is missing builtin role permissions: {sorted(missing)}"


def test_permission_catalog_covers_navigation_permissions() -> None:
    catalog = _load_permissions("0002_organization_permissions.py") | _load_permissions(
        "0004_iam_permission_ux_fixes.py"
    ) | _load_permissions("0006_audit_logging_permissions.py")
    navigation_permissions = {
        "workbench.read",
        "workbench.enrollment.review",
        "audit.read",
        "system.logs.read",
        "package.manage",
        "role.manage",
        "platform.settings.manage",
    }
    missing = navigation_permissions - catalog
    assert not missing, f"permission catalog is missing navigation permissions: {sorted(missing)}"
