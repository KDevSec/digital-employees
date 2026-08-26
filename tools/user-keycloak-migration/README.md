# agenthub 组织/成员 -> Keycloak 迁移

- `export-agenthub.py`    - 从 agenthub PostgreSQL 导出组织结构 + 成员（含 BCrypt 密码哈希）。
- `import-to-keycloak.py` - 把导出的组织 + 成员导入 Keycloak（先组织后成员，幂等）。

导入脚本的 Keycloak 连接信息默认从 `.env`（`tools/.env`）读取
（`PUBLIC_HOST` -> Keycloak URL、`KC_ADMIN_PASSWORD`），进程环境变量优先级最高，可用 `ENV_FILE` 指定别的 .env。
agenthub 无 `firstName`/`lastName`，导入时整个 `displayName` 放入 `firstName`、`lastName` 留空
（脚本自动把 `lastName` 设为非必填，否则空 `lastName` 会致登录“账号未设置完成”）。

## 1) 导出（依赖 psycopg3）
```bash
python3 export-agenthub.py                # 全量（默认仅 ACTIVE）
python3 export-agenthub.py alice         # 单条：按 user_id 或 username
```
连接/输出（括号内默认）：
```bash
AGENTHUB_PGHOST=127.0.0.1 AGENTHUB_PGPORT=5432 AGENTHUB_PGDATABASE=agenthub \
AGENTHUB_PGUSER=agenthub AGENTHUB_PGPASSWORD=agenthub_dev \
ORG_FILE=org-structure.json USERS_FILE=users.json \
python3 export-agenthub.py
```
产出 `org-structure.json` + `users.json`。

## 2) 导入（依赖 requests）
```bash
IMPORT_ORG_FILE=org-structure.json IMPORT_USERS_FILE=users.json \
python3 import-to-keycloak.py
```
只导组织 / 只导成员（按文件 `groups`/`users` 键自动识别）：
```bash
python3 import-to-keycloak.py org-structure.json   # 仅组织
python3 import-to-keycloak.py users.json            # 仅成员
```
单条导入（旧格式 `agenthub-users-export.json` 也支持，按 `users` 键识别）：
```bash
IMPORT_USERNAME=huowen python3 import-to-keycloak.py agenthub-users-export.json
```
干跑预览：`DRY_RUN=1`

## 常用环境变量
| 变量 | 默认 | 说明 |
|------|------|------|
| `ENV_FILE` | digital-employees .env | 连接信息来源 |
| `KEYCLOAK_URL` | http://`PUBLIC_HOST`:18080 | 覆盖 .env |
| `KC_ADMIN_PASSWORD` | .env | 覆盖 .env |
| `KEYCLOAK_REALM` | digital-employees | |
| `IMPORT_MODE` | bcrypt | bcrypt\|temporary\|skip |
| `IF_EXISTS` | skip | skip\|overwrite\|fail |
| `IMPORT_USERNAME` | - | 仅导入该用户 |
| `KC_BCRYPT_PROBE` | 1 | 导入前自检 bcrypt |
