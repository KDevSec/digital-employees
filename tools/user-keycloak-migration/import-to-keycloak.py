#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
import-to-keycloak.py - 把 export-agenthub.py 产出的组织结构 + 成员导入 Keycloak。

输入文件（导出脚本产出，默认在脚本目录）：
  org-structure.json  - 部门树（根域 ieisystem + agenthub 2 级 department）
  users.json          - 成员（agenthub 原生字段 + groupPath + BCrypt 密码哈希）

导入顺序：先部门（递归建组，幂等），再成员。
  - 成员 firstName/lastName 由 displayName 拆分得到（agenthub 无此字段，Keycloak
    user-profile 对 user 角色要求必填，缺失会触发 UPDATE_PROFILE）。
  - 组织属性（domain/department/team id+name）由 groupPath 反推并写入用户属性。
  - 口令：
      IMPORT_MODE=bcrypt    预哈希 BCrypt 直导（partialImport），用户用原密码登录、无需改密。
                            前提：Keycloak 已装 bcrypt PasswordHashProvider SPI（digital-employees
                            工程已带 iam/providers/bcrypt-password-hash-spi.jar，
                            realm passwordPolicy=hashAlgorithm(bcrypt) and hashIterations(12)）。
      IMPORT_MODE=temporary 随机临时口令 + 强制改密（无密码连续，兜底；SPI 不可用时用）。
      IMPORT_MODE=skip       只建用户，不设口令。
  - 已存在的用户默认不更新口令（IF_EXISTS=skip）；overwrite 才重设。

自检：bcrypt 模式默认先建探针用户实登录验证 Keycloak 能校验 $2a$12$ 哈希；失败则中止
      并给修复建议（SPI 未加载 / 未启用 passwordPolicy(bcrypt) 时常见）。

用法（连接信息与 KC_ADMIN_PASSWORD 默认取自仓库 tools/.env；
  Keycloak 为 HTTPS，自签证书默认用 tools/certs/ca.crt 校验，KC_INSECURE=1 可跳过）：
  IMPORT_ORG_FILE=org-structure.json IMPORT_USERS_FILE=users.json \
  python3 import-to-keycloak.py
  # 也可显式覆盖：KEYCLOAK_URL=https://127.0.0.1:18080 KC_ADMIN_PASSWORD=... \
  #   KC_CA_CERT=/path/to/ca.crt python3 import-to-keycloak.py
  # 只导组织：python3 import-to-keycloak.py org-structure.json
  # 只导成员：python3 import-to-keycloak.py users.json
  # 干跑：DRY_RUN=1 python3 import-to-keycloak.py
"""
import json
import os
import secrets
import string
import sys
import time
import urllib.parse
from pathlib import Path

import requests

# 连接信息优先从 .env 读取：默认取仓库内 tools/.env（相对本脚本位置推导，
# 不写死绝对路径），进程环境变量可覆盖（ENV_FILE / KEYCLOAK_URL / KC_ADMIN_PASSWORD 等）。
SCRIPT_DIR = Path(__file__).resolve().parent
TOOLS_DIR = SCRIPT_DIR.parent
ENV_FILE = os.getenv("ENV_FILE", str(TOOLS_DIR / ".env"))


def _load_dotenv(path):
    """读取 .env 文件（KEY=VALUE），返回 dict；忽略注释/空行，去首尾引号。"""
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip().strip("'").strip('"')
    except FileNotFoundError:
        pass
    return out


_ENV = _load_dotenv(ENV_FILE)


def _cfg(key, default=None):
    """优先级：进程环境变量 > .env 文件 > 默认值。"""
    v = os.getenv(key)
    if v is not None and v != "":
        return v
    if _ENV.get(key, "") != "":
        return _ENV[key]
    return default


_PUBLIC_HOST = _cfg("PUBLIC_HOST", "127.0.0.1")
KC_URL = _cfg("KEYCLOAK_URL", f"https://{_PUBLIC_HOST}:18080").rstrip("/")
KC_REALM = _cfg("KEYCLOAK_REALM", "digital-employees")
AUTH_MODE = _cfg("KC_AUTH_MODE", "admin").lower()          # admin | service
KC_ADMIN_USER = _cfg("KC_ADMIN_USER", "admin")
KC_ADMIN_PASSWORD = _cfg("KC_ADMIN_PASSWORD")  # 必填：取自 tools/.env 的 KC_ADMIN_PASSWORD
KC_CLIENT_ID = _cfg("KC_CLIENT_ID", "platform-iam-sync")
KC_CLIENT_SECRET = _cfg("KC_CLIENT_SECRET", _ENV.get("IAM_SYNC_CLIENT_SECRET"))


def _configure_tls():
    """HTTPS（自签）下的证书信任：

    - 默认使用 up.sh 生成的 tools/certs/ca.crt 验证（REQUESTS_CA_BUNDLE 对全部
      requests 调用生效）；
    - KC_CA_CERT 可指定其他 CA；
    - KC_INSECURE=1 跳过证书校验（仅排障用），并抑制 InsecureRequestWarning。
    """
    if not KC_URL.startswith("https"):
        return
    if os.getenv("KC_INSECURE", "") == "1":
        _disable_tls_verify()
        print("WARN: KC_INSECURE=1，已跳过 HTTPS 证书校验（仅限排障）。", file=sys.stderr)
        return
    ca = Path(os.getenv("KC_CA_CERT", str(TOOLS_DIR / "certs" / "ca.crt")))
    if ca.exists():
        os.environ["REQUESTS_CA_BUNDLE"] = str(ca)
        return
    _disable_tls_verify()
    print(
        f"WARN: 未找到 CA 证书（{ca}），已跳过 HTTPS 证书校验。"
        "生产环境请用 KC_CA_CERT 指定可信 CA。",
        file=sys.stderr,
    )


def _disable_tls_verify():
    try:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
    _orig = requests.api.request

    def _insecure_request(*args, **kwargs):
        kwargs.setdefault("verify", False)
        return _orig(*args, **kwargs)

    requests.api.request = _insecure_request
    requests.request = _insecure_request

IMPORT_ORG_FILE = os.getenv("IMPORT_ORG_FILE", "org-structure.json")
IMPORT_USERS_FILE = os.getenv("IMPORT_USERS_FILE", "users.json")
IMPORT_MODE = os.getenv("IMPORT_MODE", "bcrypt").lower()        # bcrypt | temporary | skip
IF_EXISTS = os.getenv("IF_EXISTS", "skip").lower()             # skip | overwrite | fail
DEFAULT_TEMP_PASSWORD = os.getenv("DEFAULT_TEMP_PASSWORD")  # 缺省时运行期随机生成
DO_PROBE = os.getenv("KC_BCRYPT_PROBE", "1") == "1"
DRY_RUN = os.getenv("DRY_RUN", "0") == "1"
TIMEOUT = 20
GROUP_MAX = int(os.getenv("KC_GROUP_MAX", "1000"))  # 列组时分页上限（Keycloak 26 children 默认仅返回 10）

BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")

PROBE_CLIENT = "__bcrypt_probe_client__"
PROBE_USER = "__bcrypt_probe_user__"
PROBE_PLAIN = "Bcrypt-Probe-2026!"
FALLBACK_PROBE_PLAIN = "keyhub-local-auth-dummy"
FALLBACK_PROBE_HASH = "$2a$12$8Q/2o2A0V.b18G2DutV4c.s5zZxH6MECM7tP8mYv6b6Q6x6o9v3vu"

# 注册到 Keycloak user-profile 的自定义组织属性（含可追溯的 agenthub_user_id）。
CUSTOM_PROFILE_ATTRS = [
    {"name": "domain_id", "displayName": "Domain ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "domain_name", "displayName": "Domain Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "department_id", "displayName": "Department ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "department_name", "displayName": "Department Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "team_id", "displayName": "Team ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "team_name", "displayName": "Team Name", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
    {"name": "agenthub_user_id", "displayName": "Agenthub User ID", "permissions": {"view": ["admin", "user"], "edit": ["admin"]}},
]


# ── 令牌 / 工具 ──────────────────────────────────────────────────────────


def _kc_token():
    """获取访问令牌。admin 走 master admin-cli password grant；service 走 client_credentials。"""
    if AUTH_MODE == "service":
        r = requests.post(
            f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect/token",
            data={"grant_type": "client_credentials", "client_id": KC_CLIENT_ID, "client_secret": KC_CLIENT_SECRET},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()["access_token"]
    r = requests.post(
        f"{KC_URL}/realms/master/protocol/openid-connect/token",
        data={"grant_type": "password", "client_id": "admin-cli",
              "username": KC_ADMIN_USER, "password": KC_ADMIN_PASSWORD},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _gen_bcrypt_hash(plain):
    """尽力生成一个 bcrypt 哈希；失败返回 None。优先 python bcrypt，其次 htpasswd。"""
    try:
        import bcrypt  # type: ignore

        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=12)).decode()
    except Exception:
        pass
    try:
        import subprocess

        out = subprocess.run(["htpasswd", "-bnBC", "12", "", plain], capture_output=True, text=True, timeout=15)
        h = out.stdout.strip()
        if h.startswith(":"):
            h = h[1:]
        if h.startswith(BCRYPT_PREFIXES):
            return h
    except Exception:
        pass
    return None


def _bcrypt_credential(password_hash):
    """构造 Keycloak 预哈希 BCrypt 凭据。

    必须带 hashIterations：Keycloak 26 的 convertDeprecatedCredentialsFormat 会对
    getHashIterations() 为 null 报 NPE。bcrypt 的 cost 已内嵌在 MCF 哈希中，这里解析出来填入，
    校验时 bcrypt provider 以哈希内 cost 为准。
    """
    cost = 12
    try:
        cost = int(password_hash.split("$")[2])
    except Exception:
        pass
    return {
        "type": "password",
        "hashedSaltedValue": password_hash,
        "algorithm": "bcrypt",
        "hashIterations": cost,
        "temporary": False,
    }


def _split_name(display_name):
    """agenthub 无独立姓/名：整个 displayName 放入 firstName，lastName 留空，避免拆分错误。"""
    name = (display_name or "").strip()
    return name, ""


# ── 组织索引 / 属性推导（参考 realm-import/import.py） ─────────────────────


def build_org_index(groups):
    """把组树拍平为 path -> {name, attributes, parent_path}。"""
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
    """沿 groupPath 向上遍历，取 domain_id/name、department_id/name、team_id/name。"""
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


# ── Keycloak 客户端 ────────────────────────────────────────────────────────


class KeycloakClient:
    def __init__(self, base_url, token, realm, token_getter=None):
        self.base_url = base_url.rstrip("/")
        self.realm = realm
        self.token_getter = token_getter  # 令牌刷新回调（返回新 token）
        self._set_token(token)

    def _set_token(self, token):
        self.token = token
        self.hdr = {"Authorization": f"Bearer {token}"}

    def _refresh(self):
        """401 时刷新令牌。"""
        if self.token_getter:
            self._set_token(self.token_getter())

    def _json_hdr(self):
        h = dict(self.hdr)
        h["Content-Type"] = "application/json"
        return h

    def _req(self, method, url, *, json_body=None, params=None, allow_redirects=True, timeout=TIMEOUT):
        """统一请求入口：遇 401 自动刷新令牌并重试一次（批量大导入时 token 会过期）。"""
        hdrs = self._json_hdr() if json_body is not None else self.hdr
        kw = {"headers": hdrs, "timeout": timeout, "allow_redirects": allow_redirects}
        if params is not None:
            kw["params"] = params
        if json_body is not None:
            kw["json"] = json_body
        r = requests.request(method, url, **kw)
        if r.status_code == 401 and self.token_getter:
            self._refresh()
            kw["headers"] = self._json_hdr() if json_body is not None else self.hdr
            r = requests.request(method, url, **kw)
        return r

    def admin(self):
        return f"{self.base_url}/admin/realms/{self.realm}"

    # ── 组织 / 组 ────────────────────────────────────────────────────────

    def _find_child_by_name(self, name, parent_id=None):
        url = (
            f"{self.admin()}/groups/{parent_id}/children?max={GROUP_MAX}"
            if parent_id else f"{self.admin()}/groups?max={GROUP_MAX}"
        )
        r = self._req("GET", url)
        data = r.json() if r.status_code == 200 else None
        if isinstance(data, list):
            for g in data:
                if g.get("name") == name:
                    return g.get("id")
        return None

    def create_group(self, name, attributes, parent_id=None):
        existing = self._find_child_by_name(name, parent_id)
        if existing:
            return existing
        payload = {"name": name}
        if attributes:
            payload["attributes"] = attributes
        url = f"{self.admin()}/groups/{parent_id}/children" if parent_id else f"{self.admin()}/groups"
        r = self._req("POST", url, json_body=payload, allow_redirects=False)
        if r.status_code in (200, 201):
            loc = r.headers.get("Location") or r.headers.get("location") or ""
            gid = loc.rstrip("/").split("/")[-1] if loc else None
            if gid:
                return gid
            return self._find_child_by_name(name, parent_id)  # 无 Location 时回查
        if r.status_code == 409:  # 已存在
            return self._find_child_by_name(name, parent_id)
        raise RuntimeError(f"create_group({name}) failed: HTTP {r.status_code} {r.text[:200]}")

    def import_groups(self, groups, parent_id=None, depth=0):
        count = 0
        for g in groups:
            name = g["name"]
            attrs = g.get("attributes") or {}
            gid = self.create_group(name, attrs, parent_id)
            hint = ", ".join(f"{k}={v[0]}" for k, v in attrs.items()) if attrs else ""
            print(f"  [GROUP] {'  ' * depth}{name}" + (f"  ({hint})" if hint else ""))
            count += 1
            subs = g.get("subGroups") or []
            if subs:
                count += self.import_groups(subs, gid, depth + 1)
        return count

    def fetch_groups(self):
        r = self._req("GET", f"{self.admin()}/groups?briefRepresentation=false&max={GROUP_MAX}")
        if r.status_code != 200 or not isinstance(r.json(), list):
            return []
        data = r.json()
        for g in data:
            self._fetch_children(g)
        return data

    def _fetch_children(self, g):
        gid = g.get("id")
        if not gid:
            return
        r = self._req("GET", f"{self.admin()}/groups/{gid}/children?briefRepresentation=false&max={GROUP_MAX}")
        children = r.json() if r.status_code == 200 else None
        if isinstance(children, list) and children:
            g["subGroups"] = children  # 复用同一对象，递归修改才能保留（勿多次 r.json()）
            for c in children:
                self._fetch_children(c)
        else:
            g.setdefault("subGroups", [])

    # ── user-profile ─────────────────────────────────────────────────────

    def ensure_user_profile(self):
        """注册自定义组织属性，并把 lastName 设为非必填（agenthub 无姓/名，lastName 留空，
        否则 Keycloak user-profile 对 user 角色必填 lastName 会致登录 "Account is not fully set up"）。"""
        r = self._req("GET", f"{self.admin()}/users/profile")
        if r.status_code != 200 or not isinstance(r.json(), dict):
            return False
        prof = r.json()
        attrs = prof.setdefault("attributes", [])
        existing = {a.get("name") for a in attrs}
        missing = [a for a in CUSTOM_PROFILE_ATTRS if a["name"] not in existing]
        changed = False
        if missing:
            attrs.extend(missing)
            changed = True
        for a in attrs:
            if a.get("name") == "lastName" and a.get("required"):
                a["required"] = None
                changed = True
        if changed:
            self._req("PUT", f"{self.admin()}/users/profile", json_body=prof)
            return True
        return False

    # ── 用户 ─────────────────────────────────────────────────────────────

    def get_user_by_username(self, username):
        qs = urllib.parse.urlencode({"username": username, "exact": "true"})
        r = self._req("GET", f"{self.admin()}/users?{qs}")
        if r.status_code == 200 and isinstance(r.json(), list) and r.json():
            return r.json()[0]
        return None

    def create_user(self, payload):
        r = self._req("POST", f"{self.admin()}/users", json_body=payload)
        if r.status_code in (200, 201):
            return True
        if r.status_code == 409:
            return False
        raise RuntimeError(f"create_user failed ({r.status_code}): {r.text[:300]}")

    def get_user_groups(self, user_id):
        r = self._req("GET", f"{self.admin()}/users/{user_id}/groups")
        return r.json() if r.status_code == 200 and isinstance(r.json(), list) else []

    def set_password(self, user_id, password, temporary):
        self._req("PUT", f"{self.admin()}/users/{user_id}/reset-password",
                  json_body={"type": "password", "value": password, "temporary": temporary})

    def update_user_attributes(self, user, attributes):
        """合并组织属性到现有用户属性（只改传入的键，保留其它），有变化才 PUT。"""
        existing = user.get("attributes") or {}
        changed = False
        for k, v in attributes.items():
            if existing.get(k) != v:
                existing[k] = v
                changed = True
        if changed:
            user["attributes"] = existing
            self._req("PUT", f"{self.admin()}/users/{user['id']}", json_body=user)
        return changed

    def set_required_actions(self, user, actions):
        cur = user.get("requiredActions") or []
        if set(cur) != set(actions):
            user["requiredActions"] = actions
            self._req("PUT", f"{self.admin()}/users/{user['id']}", json_body=user)

    def add_user_to_group(self, user_id, group_id):
        self._req("PUT", f"{self.admin()}/users/{user_id}/groups/{group_id}")

    def get_group_by_path(self, path):
        clean = path.strip("/")
        enc = urllib.parse.quote(clean, safe="/")
        r = self._req("GET", f"{self.admin()}/group-by-path/{enc}")
        if r.status_code == 200 and isinstance(r.json(), dict):
            return r.json()
        return None

    def partial_import_users(self, users, if_exists):
        """partialImport 导入用户（含预哈希凭据）。ifResourceExists: FAIL/SKIP/OVERWRITE。"""
        body = {"ifResourceExists": if_exists, "users": users}
        r = self._req("POST", f"{self.admin()}/partialImport", json_body=body, timeout=60)
        return r.status_code, r.text

# ── BCrypt 自检 ────────────────────────────────────────────────────────────


def _admin_root():
    return f"{KC_URL}/admin/realms/{KC_REALM}"


def _cleanup_probe(token):
    h = {"Authorization": f"Bearer {token}"}
    try:
        r = requests.get(f"{_admin_root()}/users", params={"username": PROBE_USER, "exact": "true"}, headers=h, timeout=TIMEOUT)
        for u in (r.json() or []):
            requests.delete(f"{_admin_root()}/users/{u['id']}", headers=h, timeout=TIMEOUT)
    except Exception:
        pass
    try:
        r = requests.get(f"{_admin_root()}/clients", params={"clientId": PROBE_CLIENT}, headers=h, timeout=TIMEOUT)
        for c in (r.json() or []):
            requests.delete(f"{_admin_root()}/clients/{c['id']}", headers=h, timeout=TIMEOUT)
    except Exception:
        pass


def _probe_bcrypt_admin(token):
    """admin 模式自检：建临时客户端 + partialImport 探针用户 + password-grant 实登录。"""
    plain = PROBE_PLAIN
    h = _gen_bcrypt_hash(plain)
    if h is None:
        plain, h = FALLBACK_PROBE_PLAIN, FALLBACK_PROBE_HASH
    hj = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        # 1) 临时 public 客户端（开启 password grant）
        try:
            requests.post(
                f"{_admin_root()}/clients",
                json={
                    "clientId": PROBE_CLIENT, "enabled": True, "publicClient": True,
                    "standardFlowEnabled": False, "directAccessGrantsEnabled": True,
                    "serviceAccountsEnabled": False,
                },
                headers=hj, timeout=TIMEOUT,
            )
        except requests.RequestException as e:
            return False, f"建临时客户端失败（需 manage-clients，请用 KC_AUTH_MODE=admin）: {e}"
        # 2) partialImport 探针用户（预哈希 bcrypt）
        r = requests.post(
            f"{_admin_root()}/partialImport",
            json={"ifResourceExists": "OVERWRITE", "users": [{
                "username": PROBE_USER, "enabled": True,
                "email": "bcrypt-probe@example.invalid", "emailVerified": True,
                "firstName": "Probe", "lastName": "User",
                "credentials": [_bcrypt_credential(h)],
            }]},
            headers=hj, timeout=TIMEOUT,
        )
        if r.status_code not in (200, 201, 204):
            return False, f"探针用户 partialImport 失败 HTTP {r.status_code}: {r.text[:300]}"
        # 3) password grant 实登录验证
        r = requests.post(
            f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": PROBE_CLIENT,
                  "username": PROBE_USER, "password": plain},
            timeout=TIMEOUT,
        )
        if r.status_code == 200 and "access_token" in (r.json() or {}):
            return True, "BCrypt 校验通过（探针 password-grant 登录成功）"
        return False, f"BCrypt 登录验证失败 HTTP {r.status_code}: {r.text[:300]}"
    finally:
        _cleanup_probe(token)


# ── 主流程 ────────────────────────────────────────────────────────────────


def wait_for_keycloak(timeout=60):
    url = f"{KC_URL}/realms/{KC_REALM}/.well-known/openid-configuration"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            requests.get(url, timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError(f"Keycloak 未就绪: {KC_URL} （realm={KC_REALM}）")


def load_json(path):
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def verify_imports(client, org_config, users):
    """导入后核对组与用户是否实际落库：
    - 组织文件中的每个组 path 都能在 Keycloak 查到；
    - 每个用户存在，且其 groupPath 已出现在用户所属组中。
    返回 (校验组数, 校验用户数, 问题明细列表)。
    """
    problems = []
    checked_groups = checked_users = 0

    if org_config and org_config.get("groups"):
        for path in sorted(build_org_index(org_config["groups"]).keys()):
            checked_groups += 1
            if not client.get_group_by_path(path):
                problems.append(f"  [MISSING GROUP] {path}")

    for entry in users or []:
        username = entry.get("username")
        if not username:
            continue
        checked_users += 1
        user = client.get_user_by_username(username)
        if not user:
            problems.append(f"  [MISSING USER]  {username}")
            continue
        group_path = entry.get("groupPath")
        if group_path:
            actual = {g.get("path") for g in client.get_user_groups(user["id"])}
            if group_path not in actual:
                problems.append(f"  [NOT IN GROUP] {username} -> {group_path}（实际: {sorted(p for p in actual if p)}）")

    return checked_groups, checked_users, problems


def main() -> int:
    args = sys.argv[1:]
    if args:
        org_config = None
        users_config = None
        for a in args:
            cfg = load_json(a)
            if not cfg:
                print(f"WARN: {a} 不存在或非合法 JSON，跳过", file=sys.stderr)
                continue
            if cfg.get("groups") is not None:
                org_config = cfg
            if cfg.get("users") is not None:
                users_config = cfg
    else:
        org_config = load_json(IMPORT_ORG_FILE)
        users_config = load_json(IMPORT_USERS_FILE)

    if not org_config and not users_config:
        print(f"ERROR: 找不到组织文件({IMPORT_ORG_FILE})或用户文件({IMPORT_USERS_FILE})", file=sys.stderr)
        return 1

    realm = (org_config or {}).get("realm") or (users_config or {}).get("realm") or KC_REALM
    has_org = bool(org_config and org_config.get("groups"))
    has_users = bool(users_config and users_config.get("users"))

    _configure_tls()

    if AUTH_MODE == "admin" and not KC_ADMIN_PASSWORD:
        print(
            f"ERROR: 缺少管理员口令：请在 {ENV_FILE} 中设置 KC_ADMIN_PASSWORD，"
            "或通过环境变量 KC_ADMIN_PASSWORD 传入。",
            file=sys.stderr,
        )
        return 1

    print(f"Keycloak:    {KC_URL}")
    print(f"Realm:       {realm}")
    print(f"导入组织:     {'是' if has_org else '否'}")
    print(f"导入成员:     {'是' if has_users else '否'}")
    print(f"口令模式:     {IMPORT_MODE}  冲突策略: {IF_EXISTS}" + ("  (dry-run)" if DRY_RUN else ""))
    print()

    try:
        wait_for_keycloak()
        token = _kc_token()
    except Exception as e:
        print(f"ERROR: 等待/连接 Keycloak 失败: {e}", file=sys.stderr)
        return 1

    client = KeycloakClient(KC_URL, token, realm, token_getter=_kc_token)
    if_exists_map = {"skip": "SKIP", "overwrite": "OVERWRITE", "fail": "FAIL"}[IF_EXISTS]

    # ── 1) 组织结构 ─────────────────────────────────────────────────────
    org_index = {}
    if has_org:
        print(f"导入组织结构（{len(org_config['groups'])} 个根组）...")
        if DRY_RUN:
            print("  [dry-run] 跳过实际建组")
        else:
            cnt = client.import_groups(org_config["groups"])
            print(f"  处理 {cnt} 个组\n")
        org_index = build_org_index(org_config["groups"])
    else:
        print("无组织文件，跳过建组。")
        print("从 Keycloak 拉取现有组以推导用户组织属性...")
        kc_groups = client.fetch_groups()
        org_index = build_org_index(kc_groups) if kc_groups else {}
        print(f"  现有组 {len(org_index)} 个\n")
    if not org_index and has_users:
        print("WARN: 无组织索引，用户将不带组织属性。\n", file=sys.stderr)

    if not has_users:
        print("无用户文件，跳过成员导入。")
        if has_org and not DRY_RUN:
            cg, _cu, problems = verify_imports(client, org_config, [])
            print(f"\n校验：组 {cg} 个...")
            if problems:
                print("\n".join(problems), file=sys.stderr)
                print(f"校验失败 {len(problems)} 项", file=sys.stderr)
                return 1
            print("校验通过：所有组均已创建。")
        return 0

    users = users_config["users"]
    default_password = users_config.get("defaultPassword") or DEFAULT_TEMP_PASSWORD
    if IMPORT_MODE == "temporary" and not default_password and not DRY_RUN:
        alphabet = string.ascii_letters + string.digits
        default_password = "".join(secrets.choice(alphabet) for _ in range(20))
        print(f"  [INFO] 未配置临时口令，已随机生成: {default_password}")
    filter_user = os.getenv("IMPORT_USERNAME", "").strip().lower()
    if filter_user:
        users = [u for u in users if (u.get("username") or "").lower() == filter_user]
        print(f"按 IMPORT_USERNAME 过滤：仅导入 {len(users)} 个（{filter_user}）")
        if not users:
            print("ERROR: 过滤后无匹配用户", file=sys.stderr)
            return 1

    if not DRY_RUN:
        if client.ensure_user_profile():
            print(f"已向 user-profile 注册 {len(CUSTOM_PROFILE_ATTRS)} 个自定义组织属性。\n")

    # ── 2) BCrypt 自检 ──────────────────────────────────────────────────
    if IMPORT_MODE == "bcrypt" and not DRY_RUN:
        if DO_PROBE:
            if AUTH_MODE == "admin":
                ok, msg = _probe_bcrypt_admin(token)
            else:
                ok, msg = False, "service 模式无法自检（缺 manage-clients）。请用 KC_AUTH_MODE=admin 或 KC_BCRYPT_PROBE=0 跳过。"
            print(f"[自检] {msg}")
            if not ok:
                print(
                    "\n中止：Keycloak 无法校验 BCrypt 哈希。可能原因：\n"
                    "  - bcrypt SPI 未加载（确认 iam/providers/bcrypt-password-hash-spi.jar 已挂载并已重启）\n"
                    "  - realm passwordPolicy 未设为 hashAlgorithm(bcrypt)\n"
                    "建议：\n"
                    "  1) Keycloak 管理台 Authentication > Password hashing 确认有 bcrypt\n"
                    "  2) 或改临时口令模式：IMPORT_MODE=temporary python3 import-to-keycloak.py\n"
                    "     （首登强制改密，无密码连续性）\n"
                    "  3) 仅预览：DRY_RUN=1 python3 import-to-keycloak.py",
                    file=sys.stderr,
                )
                return 3
        else:
            print("[自检] 已跳过 (KC_BCRYPT_PROBE=0)\n")

    # ── 3) 成员 ────────────────────────────────────────────────────────
    print(f"导入成员（{len(users)} 个）..." + (f"  临时口令={default_password}" if IMPORT_MODE == "temporary" else ""))
    created = existed = failed = 0
    for entry in users:
        username = entry.get("username")
        if not username:
            print("  [ERROR] 跳过无 username 的条目", file=sys.stderr)
            failed += 1
            continue
        group_path = entry.get("groupPath")
        first, last = _split_name(entry.get("displayName"))
        org_attrs = derive_user_attributes([group_path], org_index) if (group_path and org_index) else {}
        aid = entry.get("agenthubUserId")
        if aid is None:
            aid = entry.get("userId")  # 兼容旧导出格式 agenthub-users-export.json
        if aid is not None:
            org_attrs["agenthub_user_id"] = [str(aid)]
        email = entry.get("email") or f"{username}@imported.example.com"
        required = ["UPDATE_PASSWORD"] if IMPORT_MODE == "temporary" else []
        base = {
            "username": username,
            "email": email,
            "firstName": first,
            "lastName": last,
            "enabled": bool(entry.get("enabled", True)),
            "emailVerified": True,
            "requiredActions": required,
            "attributes": org_attrs,
        }

        if DRY_RUN:
            print(f"  [dry-run] {username} first={first!r} last={last!r} "
                  f"group={group_path} attrs={list(org_attrs)}")
            continue

        try:
            existing = client.get_user_by_username(username)

            if IMPORT_MODE == "bcrypt":
                pi_user = dict(base)
                ph = entry.get("passwordHash") or ""
                if ph.startswith(BCRYPT_PREFIXES):
                    pi_user["credentials"] = [_bcrypt_credential(ph)]
                elif ph:
                    print(f"  [WARN] {username} 哈希非 BCrypt，不设口令: {ph[:12]}...", file=sys.stderr)
                code, body = client.partial_import_users([pi_user], if_exists_map)
                if code not in (200, 201, 204):
                    raise RuntimeError(f"partialImport HTTP {code}: {body[:200]}")
                user = client.get_user_by_username(username)
                if not user:
                    raise RuntimeError("partialImport 后未找到用户")
                is_new = existing is None
            else:  # temporary | skip
                if existing:
                    user = existing
                    user_id = existing["id"]
                    is_new = False
                else:
                    client.create_user(base)
                    user = client.get_user_by_username(username)
                    if not user:
                        raise RuntimeError("创建后未找到用户")
                    user_id = user["id"]
                    is_new = True
                if IMPORT_MODE == "temporary" and (is_new or IF_EXISTS == "overwrite"):
                    client.set_password(user_id, default_password, temporary=True)
                    client.set_required_actions(user, ["UPDATE_PASSWORD"])

            # 同步组织属性 + 挂组（幂等）
            if org_attrs:
                client.update_user_attributes(user, org_attrs)
            if group_path:
                g = client.get_group_by_path(group_path)
                if g and g.get("id"):
                    client.add_user_to_group(user["id"], g["id"])
                else:
                    print(f"  [WARN] {username} 组未找到: {group_path}", file=sys.stderr)

            tag = "CREATED" if is_new else "EXISTS"
            attr_sum = ", ".join(f"{k}={v[0]}" for k, v in org_attrs.items()) if org_attrs else ""
            print(f"  [{tag}] {username} -> {group_path or '(无组)'}" + (f"  ({attr_sum})" if attr_sum else ""))
            created += 1 if is_new else 0
            existed += 0 if is_new else 1
        except Exception as e:
            failed += 1
            print(f"  [ERROR] {username}: {e}", file=sys.stderr)

    print(f"\n完成：新建 {created}，已存在 {existed}，失败 {failed}")

    if not DRY_RUN and not failed:
        cg, cu, problems = verify_imports(client, org_config, users)
        print(f"\n校验导入结果：组 {cg} 个、用户 {cu} 个...")
        if problems:
            print("\n".join(problems[:50]), file=sys.stderr)
            if len(problems) > 50:
                print(f"  ... 其余 {len(problems) - 50} 项省略", file=sys.stderr)
            print(f"校验失败 {len(problems)} 项", file=sys.stderr)
            return 1
        print("校验通过：所有组与用户均已落库，且用户挂组正确。")

    if IMPORT_MODE == "bcrypt" and not DRY_RUN and not failed:
        print(f"验证：用任一 agenthub 用户名 + 原密码登录\n  {KC_URL}/realms/{realm}/account/")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
