#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export-agenthub.py - 从 agenthub 导出组织结构 + 成员，产出两个文件：
  org-structure.json - 部门树(参考 digital-employees/tools/realm-import 格式)
  users.json          - 成员(agenthub 原生字段，不含 first/last 等无对应字段)

组织映射(参考 realm-import，按 agenthub 2 级 department 表)：
  根域 = ieisystem（domain_id=domain-ieisystem）
  agenthub 顶级部门(parent_id NULL) -> department 组（department_id=dept.id）
  agenthub 团队(parent_id NOT NULL) -> team 组（team_id=dept.id），挂在父部门下
  组名 = department.display_name；用户所属组路径 groupPath 由导出预算好。

数据来源（agenthub PostgreSQL）：
  department(id,slug,display_name,parent_id,leader_user_id,status)
  user_account(id,display_name,email,avatar_url,status,department_id,...)
  local_credential(user_id,username,password_hash)  ← BCrypt 哈希

用法：
  python3 export-agenthub.py                       # 全量(仅 ACTIVE)
  python3 export-agenthub.py usr_abc123            # 仅该 user_id/username 的成员
  AGENTHUB_USER_ID=usr_abc123 python3 export-agenthub.py
  # 连接/输出(括号内默认)
  AGENTHUB_PGHOST=127.0.0.1 AGENTHUB_PGPORT=5432 AGENTHUB_PGDATABASE=agenthub \
  AGENTHUB_PGUSER=agenthub AGENTHUB_PGPASSWORD=agenthub_dev \
  REALM=digital-employees DEFAULT_PASSWORD='Horse~test@2026' TEMPORARY_PASSWORD=true \
  ORG_FILE=org-structure.json USERS_FILE=users.json \
  python3 export-agenthub.py
"""
import json
import os
import sys

import psycopg

PGHOST = os.getenv("AGENTHUB_PGHOST", "127.0.0.1")
PGPORT = int(os.getenv("AGENTHUB_PGPORT", "5432"))
PGDATABASE = os.getenv("AGENTHUB_PGDATABASE", "agenthub")
PGUSER = os.getenv("AGENTHUB_PGUSER", "agenthub")
PGPASSWORD = os.getenv("AGENTHUB_PGPASSWORD", "agenthub_dev")
REALM = os.getenv("REALM", os.getenv("KC_REALM", "digital-employees"))
ROOT_DOMAIN_NAME = os.getenv("ROOT_DOMAIN_NAME", "ieisystem")
ROOT_DOMAIN_ID = os.getenv("ROOT_DOMAIN_ID", "domain-ieisystem")
DEFAULT_PASSWORD = os.getenv("DEFAULT_PASSWORD", "Horse~test@2026")
TEMPORARY_PASSWORD = os.getenv("TEMPORARY_PASSWORD", "true").lower() in ("1", "true", "yes")
STATUSES = os.getenv("AGENTHUB_EXPORT_STATUSES", "ACTIVE").strip()
ORG_FILE = os.getenv("ORG_FILE", "org-structure.json")
USERS_FILE = os.getenv("USERS_FILE", "users.json")

BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def fetch_departments(cur):
    cur.execute(
        """SELECT id, slug, display_name, parent_id, leader_user_id, status::text
           FROM department ORDER BY parent_id NULLS FIRST, id"""
    )
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def fetch_users(cur, target, user_id_env, username_env, statuses):
    if target:
        where, params = "WHERE (ua.id = %s OR LOWER(lc.username) = LOWER(%s))", [target, target]
    elif user_id_env:
        where, params = "WHERE ua.id = %s", [user_id_env]
    elif username_env:
        where, params = "WHERE LOWER(lc.username) = LOWER(%s)", [username_env]
    else:
        ph = ",".join(["%s"] * len(statuses))
        where, params = f"WHERE ua.status::text IN ({ph})", statuses
    cur.execute(
        f"""SELECT ua.id, ua.display_name, ua.email, ua.avatar_url, ua.status::text,
                  ua.department_id, ua.onboarding_completed, ua.merged_to_user_id,
                  lc.username, lc.password_hash
           FROM user_account ua
           JOIN local_credential lc ON lc.user_id = ua.id
           {where}
           ORDER BY lc.username""",
        params,
    )
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def build_org_structure(depts):
    children = {}
    for d in depts:
        children.setdefault(d["parent_id"], []).append(d)

    def subgroups(parent_id):
        out = []
        for d in children.get(parent_id, []):
            is_team = d["parent_id"] is not None
            attrs = {"team_id" if is_team else "department_id": [str(d["id"])]}
            if d.get("slug"):
                attrs["org_code"] = [d["slug"]]
            if d.get("status"):
                attrs["status"] = [d["status"]]
            if d.get("leader_user_id"):
                attrs["leader_user_id"] = [d["leader_user_id"]]
            node = {"name": d["display_name"], "attributes": attrs}
            sub = subgroups(d["id"])
            if sub:
                node["subGroups"] = sub
            out.append(node)
        return out

    return {
        "realm": REALM,
        "groups": [
            {
                "name": ROOT_DOMAIN_NAME,
                "attributes": {
                    "domain_id": [ROOT_DOMAIN_ID],
                    "org_code": [ROOT_DOMAIN_NAME],
                    "status": ["ACTIVE"],
                },
                "subGroups": subgroups(None),
            }
        ],
    }


def group_path(dept_id, dept_map):
    """算用户所属组的 Keycloak 路径：顶级部门 -> /ieisystem/<dept>；团队 -> /ieisystem/<父部门>/<团队>。"""
    if dept_id is None:
        return None
    d = dept_map.get(int(dept_id))
    if not d:
        return None
    if d["parent_id"] is None:
        return f"/{ROOT_DOMAIN_NAME}/{d['display_name']}"
    parent = dept_map.get(d["parent_id"])
    if not parent:
        return f"/{ROOT_DOMAIN_NAME}/{d['display_name']}"
    return f"/{ROOT_DOMAIN_NAME}/{parent['display_name']}/{d['display_name']}"


def build_users_config(users, dept_map):
    out = []
    for u in users:
        username = u["username"]
        if not username:
            print(f"WARN: 跳过无 local_credential 的账号 {u['id']!r}", file=sys.stderr)
            continue
        email = u["email"] or f"{username}@imported.example.com"
        if not u["email"]:
            print(f"WARN: {username!r} 无 email，使用占位 {email}", file=sys.stderr)
        path = group_path(u["department_id"], dept_map)
        if not path:
            print(f"WARN: {username!r} department_id={u['department_id']} 未匹配部门，不挂组", file=sys.stderr)
        ph = u.get("password_hash") or ""
        if ph and not ph.startswith(BCRYPT_PREFIXES):
            print(f"WARN: {username!r} 哈希非 BCrypt，跳过留档", file=sys.stderr)
            ph = ""
        out.append(
            {
                "username": username,
                "email": email,
                "displayName": u["display_name"],
                "status": u["status"],
                "enabled": u["status"] == "ACTIVE",
                "departmentId": u["department_id"],
                "groupPath": path,
                "passwordHash": ph,
                "agenthubUserId": u["id"],
                "avatarUrl": u["avatar_url"],
                "onboardingCompleted": u["onboarding_completed"],
                "mergedToUserId": u["merged_to_user_id"],
            }
        )
    return {
        "realm": REALM,
        "source": "agenthub",
        "defaultPassword": DEFAULT_PASSWORD,
        "temporaryPassword": TEMPORARY_PASSWORD,
        "users": out,
    }


def main() -> int:
    target = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    user_id_env = (os.getenv("AGENTHUB_USER_ID") or "").strip()
    username_env = (os.getenv("AGENTHUB_USERNAME") or "").strip()
    statuses = [s.strip() for s in STATUSES.split(",") if s.strip()]
    if not statuses and not (target or user_id_env or username_env):
        print("ERROR: AGENTHUB_EXPORT_STATUSES 为空且未指定唯一 id", file=sys.stderr)
        return 2

    conn_kwargs = dict(host=PGHOST, port=PGPORT, dbname=PGDATABASE, user=PGUSER, password=PGPASSWORD)
    try:
        with psycopg.connect(**conn_kwargs, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                depts = fetch_departments(cur)
                users = fetch_users(cur, target, user_id_env, username_env, statuses)
    except Exception as e:
        print(f"ERROR: 连接/查询 agenthub 数据库失败: {e}", file=sys.stderr)
        print(f"  (host={PGHOST}:{PGPORT} db={PGDATABASE} user={PGUSER})", file=sys.stderr)
        return 1

    dept_map = {d["id"]: d for d in depts}
    org = build_org_structure(depts)
    users_cfg = build_users_config(users, dept_map)

    with open(ORG_FILE, "w", encoding="utf-8") as f:
        json.dump(org, f, ensure_ascii=False, indent=2)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users_cfg, f, ensure_ascii=False, indent=2)

    flt = f"单条(id={target or user_id_env or username_env})" if (target or user_id_env or username_env) else f"全量(status={statuses})"
    print(f"OK: 组织 {len(depts)} 个部门 -> {ORG_FILE}  (根域={ROOT_DOMAIN_NAME})")
    print(f"OK: 成员 {len(users_cfg['users'])} 个 -> {USERS_FILE}  [{flt}]  tempPwd={TEMPORARY_PASSWORD}")
    print("导入: IMPORT_ORG_FILE=" + ORG_FILE + " IMPORT_USERS_FILE=" + USERS_FILE +
          " python3 import-to-keycloak.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
