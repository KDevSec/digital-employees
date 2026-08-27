#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export-agenthub-users.py - 从 agenthub 的 PostgreSQL 导出本地账号（用户名 + BCrypt 密码哈希）。

支持：
  - 全量导出（默认，仅 status=ACTIVE 可登录账号）
  - 单条导出：按 agenthub 的唯一 id（user_id 或 username）导出单条

数据来源：
  - local_credential(user_id, username, password_hash)  ← BCrypt($2a$12$) 哈希
  - user_account(id, display_name, email, status)

明文不可逆；导出的是 password_hash（BCrypt MCF），可被 Keycloak 以预哈希口令导入。

用法：
  # 全量（仅 ACTIVE）
  python3 export-agenthub-users.py

  # 单条：按 user_id 或 username（脚本会同时匹配两者）
  python3 export-agenthub-users.py usr_abc123
  python3 export-agenthub-users.py alice

  # 也可用环境变量指定唯一 id（与位置参数二选一）
  AGENTHUB_USER_ID=usr_abc123 python3 export-agenthub-users.py
  AGENTHUB_USERNAME=alice     python3 export-agenthub-users.py

  # 连接/输出（括号内为默认值，来自 docker-compose.yml）
  AGENTHUB_PGHOST=127.0.0.1 AGENTHUB_PGPORT=5432 AGENTHUB_PGDATABASE=agenthub \
  AGENTHUB_PGUSER=agenthub AGENTHUB_PGPASSWORD=agenthub_dev \
  AGENTHUB_EXPORT_FILE=agenthub-users-export.json \
  python3 export-agenthub-users.py

说明：
  - 全量默认仅导出 status=ACTIVE；可用 AGENTHUB_EXPORT_STATUSES 改（如 ACTIVE,PENDING）。
  - 单条按 id 导出时不受 status 限制（导出该账号及其状态，导入时按状态设 enabled）。
  - 非 BCrypt 哈希会被跳过并告警。
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
STATUSES = os.getenv("AGENTHUB_EXPORT_STATUSES", "ACTIVE").strip()
EXPORT_FILE = os.getenv("AGENTHUB_EXPORT_FILE", "agenthub-users-export.json")

BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def main() -> int:
    target = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    user_id_env = (os.getenv("AGENTHUB_USER_ID") or "").strip()
    username_env = (os.getenv("AGENTHUB_USERNAME") or "").strip()

    where = ""
    params: list = []
    filter_desc = "全量(status=ACTIVE)"
    if target:
        where = "WHERE (lc.user_id = %s OR LOWER(lc.username) = LOWER(%s))"
        params = [target, target]
        filter_desc = f"单条(id={target})"
    elif user_id_env:
        where = "WHERE lc.user_id = %s"
        params = [user_id_env]
        filter_desc = f"单条(user_id={user_id_env})"
    elif username_env:
        where = "WHERE LOWER(lc.username) = LOWER(%s)"
        params = [username_env]
        filter_desc = f"单条(username={username_env})"
    else:
        statuses = [s.strip() for s in STATUSES.split(",") if s.strip()]
        if not statuses:
            print("ERROR: AGENTHUB_EXPORT_STATUSES 为空", file=sys.stderr)
            return 2
        ph = ",".join(["%s"] * len(statuses))
        where = f"WHERE ua.status::text IN ({ph})"
        params = statuses

    sql = f"""
        SELECT lc.user_id,
               lc.username,
               ua.email,
               ua.display_name,
               lc.password_hash,
               ua.status::text AS status
        FROM local_credential lc
        JOIN user_account ua ON ua.id = lc.user_id
        {where}
        ORDER BY lc.username
    """

    # 用 kwargs 连接，避免含 @/~/$ 等特殊字符的密码走 libpq conninfo 转义问题
    conn_kwargs = dict(
        host=PGHOST, port=PGPORT, dbname=PGDATABASE, user=PGUSER, password=PGPASSWORD
    )
    rows = []
    try:
        with psycopg.connect(**conn_kwargs, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                for uid, uname, email, dname, ph_val, st in cur:
                    if not ph_val or not ph_val.startswith(BCRYPT_PREFIXES):
                        print(
                            f"WARN: 跳过非 BCrypt 哈希用户 {uname!r}: {str(ph_val)[:16]}...",
                            file=sys.stderr,
                        )
                        continue
                    rows.append(
                        {
                            "userId": uid,
                            "username": uname,
                            "email": email,
                            "displayName": dname,
                            "passwordHash": ph_val,
                            "status": st,
                        }
                    )
    except Exception as e:
        print(f"ERROR: 连接/查询 agenthub 数据库失败: {e}", file=sys.stderr)
        print(
            f"  (host={PGHOST}:{PGPORT} db={PGDATABASE} user={PGUSER})",
            file=sys.stderr,
        )
        return 1

    with open(EXPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": "agenthub",
                "hashAlgorithm": "bcrypt",
                "filter": filter_desc,
                "hashProviderNote": "Spring BCryptPasswordEncoder cost=12, MCF $2a$12$...",
                "users": rows,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"OK: 导出 {len(rows)} 个账号 -> {EXPORT_FILE}  [{filter_desc}]")
    if not rows and (target or user_id_env or username_env):
        print("    未找到匹配该唯一 id 的账号。")
    if rows:
        print(
            f"    样例: username={rows[0]['username']!r} "
            f"hash={rows[0]['passwordHash'][:18]}..."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
