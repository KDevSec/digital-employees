#!/usr/bin/env python3
"""Import organization structure and/or users into a Keycloak realm.

Usage:
    python3 import.py                              # both: org-structure.json + users.json (script dir)
    python3 import.py org-structure.json           # org structure only (auto-detected by "groups" key)
    python3 import.py users.json                   # users only (auto-detected by "users" key)
    python3 import.py org.json users.json           # both, explicit paths

When importing users, the script derives domain_id/department_id/team_id
attributes from each user's group membership and sets them on the Keycloak
user so that OIDC token claims include correct org context.
"""


import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_KC_URL = "http://localhost:18080"
DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASSWORD = "Horse~test@2026"
DEFAULT_REALM = "digital-employees"
CUSTOM_PROFILE_ATTRS = [
    {"name": "domain_id", "displayName": "Domain ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "domain_name", "displayName": "Domain Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "department_id", "displayName": "Department ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "department_name", "displayName": "Department Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "team_id", "displayName": "Team ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "team_name", "displayName": "Team Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "primary_org_id", "displayName": "Primary Org ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
]



# ── Keycloak client ──────────────────────────────────────────────────────


class KeycloakClient:
    def __init__(self, base_url: str, token: str, realm: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.realm = realm

    def _request(self, method, path, data=None, get_headers=False):
        url = f"{self.base_url}{path}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                parsed = json.loads(raw) if raw and resp.status != 204 else None
                headers = dict(resp.headers) if get_headers else None
                return resp.status, parsed, headers
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            try:
                detail = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                detail = raw
            return exc.code, detail, None

    # ── Groups ──────────────────────────────────────────────────────────

    def _find_child_by_name(self, name, parent_id=None):
        if parent_id:
            status, data, _ = self._request("GET", f"/admin/realms/{self.realm}/groups/{parent_id}/children")
        else:
            status, data, _ = self._request("GET", f"/admin/realms/{self.realm}/groups")
        if status == 200 and isinstance(data, list):
            for group in data:
                if group.get("name") == name:
                    return group.get("id")
        return None

    def create_group(self, name, attributes, parent_id=None):
        existing = self._find_child_by_name(name, parent_id)
        if existing:
            return existing
        payload = {"name": name}
        if attributes:
            payload["attributes"] = attributes
        path = (
            f"/admin/realms/{self.realm}/groups/{parent_id}/children"
            if parent_id
            else f"/admin/realms/{self.realm}/groups"
        )
        status, _, headers = self._request("POST", path, payload, get_headers=True)
        if status in (200, 201) and headers:
            location = headers.get("Location") or headers.get("location") or ""
            gid = location.rstrip("/").split("/")[-1]
            if gid:
                return gid
        raise RuntimeError(f"create_group({name}) failed: HTTP {status}")

    def import_groups(self, groups, parent_id=None, depth=0):
        count = 0
        for group in groups:
            name = group["name"]
            attributes = group.get("attributes") or {}
            gid = self.create_group(name, attributes, parent_id)
            label = "  " * depth + name
            attr_hint = ", ".join(f"{k}={v[0]}" for k, v in attributes.items()) if attributes else ""
            print(f"  [GROUP] {label}  ({attr_hint})" if attr_hint else f"  [GROUP] {label}")
            count += 1
            children = group.get("subGroups") or []
            if children:
                count += self.import_groups(children, gid, depth + 1)
        return count

    def fetch_groups(self):
        status, data, _ = self._request("GET", f"/admin/realms/{self.realm}/groups?briefRepresentation=false")
        if status != 200 or not isinstance(data, list):
            return []
        for group in data:
            self._fetch_children(group)
        return data

    def _fetch_children(self, group):
        gid = group.get("id")
        if not gid:
            return
        status, data, _ = self._request(
            "GET", f"/admin/realms/{self.realm}/groups/{gid}/children?briefRepresentation=false"
        )
        if status == 200 and isinstance(data, list) and data:
            group["subGroups"] = data
            for child in data:
                self._fetch_children(child)
        else:
            group["subGroups"] = group.get("subGroups") or []


    def ensure_user_profile(self):
        """Configure Keycloak user profile to accept custom org attributes."""
        status, profile, _ = self._request("GET", f"/admin/realms/{self.realm}/users/profile")
        if status != 200 or not isinstance(profile, dict):
            return False
        existing_names = {a.get("name") for a in profile.get("attributes", [])}
        missing = [attr for attr in CUSTOM_PROFILE_ATTRS if attr["name"] not in existing_names]
        if not missing:
            return False
        profile.setdefault("attributes", []).extend(missing)
        self._request("PUT", f"/admin/realms/{self.realm}/users/profile", profile)
        return True

    # ── Users ───────────────────────────────────────────────────────────

    def get_user_by_username(self, username):
        qs = urllib.parse.urlencode({"username": username, "exact": "true"})
        status, data, _ = self._request("GET", f"/admin/realms/{self.realm}/users?{qs}")
        if status == 200 and isinstance(data, list) and data:
            return data[0]
        return None

    def create_user(self, user):
        status, detail = self._request("POST", f"/admin/realms/{self.realm}/users", user)[:2]
        if status in (200, 201):
            return True
        if status == 409:
            return False
        raise RuntimeError(f"create_user failed ({status}): {detail}")

    def set_password(self, user_id, password, temporary):
        self._request(
            "PUT",
            f"/admin/realms/{self.realm}/users/{user_id}/reset-password",
            {"type": "password", "value": password, "temporary": temporary},
        )


    def update_user_attributes(self, user_id, attributes):
        status, user, _ = self._request("GET", f"/admin/realms/{self.realm}/users/{user_id}")
        if status != 200 or not isinstance(user, dict):
            return
        existing = user.get("attributes") or {}
        changed = False
        for key, val in attributes.items():
            if existing.get(key) != val:
                existing[key] = val
                changed = True
        if changed:
            user["attributes"] = existing
            self._request("PUT", f"/admin/realms/{self.realm}/users/{user_id}", user)

    def add_user_to_group(self, user_id, group_id):
        self._request("PUT", f"/admin/realms/{self.realm}/users/{user_id}/groups/{group_id}")

    def get_group_by_path(self, path):
        clean = path.strip("/")
        encoded = urllib.parse.quote(clean, safe="/")
        status, data, _ = self._request("GET", f"/admin/realms/{self.realm}/group-by-path/{encoded}")
        return data if isinstance(data, dict) else None


# ── Org index: flatten group tree into path -> node ──────────────────────


def build_org_index(groups):
    index = {}

    def visit(group, parent_path=None):
        name = group["name"]
        path = f"{parent_path}/{name}" if parent_path else f"/{name}"
        index[path] = {
            "name": name,
            "attributes": group.get("attributes") or {},
            "parent_path": parent_path,
        }
        for child in group.get("subGroups") or []:
            visit(child, path)

    for root in groups:
        visit(root)
    return index


def _attr_value(attrs, key):
    val = attrs.get(key)
    if isinstance(val, list) and val:
        return val[0]
    if isinstance(val, str):
        return val
    return None


def derive_user_attributes(group_paths, org_index):
    domain_id = domain_name = None
    dept_id = dept_name = None
    team_id = team_name = None

    for path in group_paths:
        current = path
        while current and current in org_index:
            node = org_index[current]
            attrs = node["attributes"]
            if "domain_id" in attrs and not domain_id:
                domain_id = _attr_value(attrs, "domain_id")
                domain_name = node["name"]
            if "department_id" in attrs and not dept_id:
                dept_id = _attr_value(attrs, "department_id")
                dept_name = node["name"]
            if "team_id" in attrs and not team_id:
                team_id = _attr_value(attrs, "team_id")
                team_name = node["name"]
            current = org_index[current]["parent_path"]

    attributes = {}
    if domain_id:
        attributes["domain_id"] = [domain_id]
        attributes["domain_name"] = [domain_name]
    if dept_id:
        attributes["department_id"] = [dept_id]
        attributes["department_name"] = [dept_name]
    if team_id:
        attributes["team_id"] = [team_id]
        attributes["team_name"] = [team_name]
    return attributes


# ── Helpers ──────────────────────────────────────────────────────────────


def get_admin_token(base_url, admin_user, admin_password):
    data = urllib.parse.urlencode({
        "client_id": "admin-cli",
        "username": admin_user,
        "password": admin_password,
        "grant_type": "password",
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/realms/master/protocol/openid-connect/token",
        data=data, method="POST",
    )
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def wait_for_keycloak(base_url, realm, timeout=60):
    url = f"{base_url}/realms/{realm}/.well-known/openid-configuration"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError(f"Keycloak not ready at {base_url} after {timeout}s")


def load_json(path):
    p = Path(path)
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


# ── Main ─────────────────────────────────────────────────────────────────


def main():
    script_dir = Path(__file__).parent
    args = sys.argv[1:]

    if not args:
        org_config = load_json(script_dir / "org-structure.json")
        users_config = load_json(script_dir / "users.json")
    else:
        org_config = None
        users_config = None
        for arg in args:
            config = load_json(arg)
            if not config:
                print(f"Warning: {arg} not found or invalid, skipping", file=sys.stderr)
                continue
            if config.get("groups") is not None:
                org_config = config
            if config.get("users") is not None:
                users_config = config

    if not org_config and not users_config:
        print("Error: no valid org-structure or users file found", file=sys.stderr)
        return 1

    kc_url = os.environ.get("KEYCLOAK_URL", DEFAULT_KC_URL)
    admin_user = os.environ.get("ADMIN_USER", DEFAULT_ADMIN_USER)
    admin_password = os.environ.get("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
    realm = (org_config or {}).get("realm") or (users_config or {}).get("realm") or DEFAULT_REALM

    has_org = org_config and org_config.get("groups")
    has_users = users_config and users_config.get("users")

    print(f"Keycloak:    {kc_url}")
    print(f"Realm:       {realm}")
    print(f"Org import:  {'yes' if has_org else 'no'}")
    print(f"User import: {'yes' if has_users else 'no'}")
    print()

    wait_for_keycloak(kc_url, realm)
    token = get_admin_token(kc_url, admin_user, admin_password)
    client = KeycloakClient(kc_url, token, realm)

    # ── Import org structure ────────────────────────────────────────────
    if has_org:
        groups = org_config["groups"]
        print(f"Importing organization structure ({len(groups)} top-level)...")
        count = client.import_groups(groups)
        print(f"  {count} groups processed\n")
    else:
        print("Skipping org structure (no groups file).\n")

    # ── Import users ─────────────────────────────────────────────────────
    if not has_users:
        print("Skipping users (no users file).")
        return 0

    users = users_config["users"]
    default_password = users_config.get("defaultPassword", "Horse~test@2026")
    default_temporary = users_config.get("temporaryPassword", True)

    # Build org index for attribute derivation
    org_index = {}
    if org_config and org_config.get("groups"):
        org_index = build_org_index(org_config["groups"])
    if not org_index:
        print("Fetching groups from Keycloak for attribute derivation...")
        kc_groups = client.fetch_groups()
        org_index = build_org_index(kc_groups)
    if not org_index:
        print("Warning: no org groups found, users will be created without org attributes.\n")
    else:
        print(f"Org index: {len(org_index)} groups resolved.\n")

    if client.ensure_user_profile():
        print(f"Configured user profile with {len(CUSTOM_PROFILE_ATTRS)} custom attributes.\n")
    print(f"Importing users ({len(users)})...  tempPwd={default_temporary}")
    created = skipped = failed = 0
    for entry in users:
        username = entry["username"]
        password = entry.get("password", default_password)
        temporary = entry.get("temporaryPassword", default_temporary)
        user_groups = entry.get("groups", [])

        # Derive org attributes from group membership
        attributes = derive_user_attributes(user_groups, org_index) if org_index else {}

        existing = client.get_user_by_username(username)
        if existing:
            user_id = existing["id"]
            print(f"  [EXISTS]  {username}")
            if attributes:
                client.update_user_attributes(user_id, attributes)
                attr_summary = ", ".join(f"{k}={v[0]}" for k, v in attributes.items())
                print(f"            attrs synced: {attr_summary}")
            skipped += 1
        else:
            payload = {
                "username": username,
                "email": entry.get("email", ""),
                "firstName": entry.get("firstName", ""),
                "lastName": entry.get("lastName", ""),
                "enabled": entry.get("enabled", True),
            }
            if attributes:
                payload["attributes"] = attributes
            try:
                client.create_user(payload)
            except RuntimeError as exc:
                print(f"  [ERROR]   {username}: {exc}")
                failed += 1
                continue
            created_user = client.get_user_by_username(username)
            if not created_user:
                print(f"  [ERROR]   {username}: created but not found")
                failed += 1
                continue
            user_id = created_user["id"]
            print(f"  [CREATED] {username}")
            if attributes:
                attr_summary = ", ".join(f"{k}={v[0]}" for k, v in attributes.items())
                print(f"            attrs: {attr_summary}")
            created += 1

        if password:
            client.set_password(user_id, password, temporary)
            tag = "temp" if temporary else "permanent"
            print(f"            password ({tag})")

        for group_path in user_groups:
            group = client.get_group_by_path(group_path)
            gid = group.get("id") if group else None
            if gid:
                client.add_user_to_group(user_id, gid)
                print(f"            -> {group_path}")
            else:
                print(f"            [WARN] group not found: {group_path}")

    print(f"\nDone: {created} created, {skipped} existed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
