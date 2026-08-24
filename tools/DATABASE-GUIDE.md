# 数据库查询指南

本文档说明如何连接和查询平台两个 PostgreSQL 数据库：**platform**（管理平台业务库）和 **keycloak**（Keycloak 身份认证库）。

两个数据库在同一 PostgreSQL 容器中，由 `tools/compose.yml` 的 `postgres` 服务提供。

## 1. 连接方式

### 1.1 进入交互式 psql

```bash
# platform 库（管理平台业务数据）
./tools/compose.sh exec -T postgres psql -U platform -d platform

# keycloak 库（身份认证数据）
./tools/compose.sh exec -T postgres psql -U keycloak -d keycloak
```

### 1.2 执行单条 SQL

```bash
./tools/compose.sh exec -T postgres psql -U platform -d platform -c "SELECT * FROM iam_principal LIMIT 5;"

./tools/compose.sh exec -T postgres psql -U keycloak -d keycloak -c "SELECT client_id, secret FROM client WHERE client_id LIKE 'platform%';"
```

### 1.3 执行多条 SQL

```bash
./tools/compose.sh exec -T postgres psql -U platform -d platform <<'SQL'
\dt
SELECT count(*) FROM iam_principal;
SQL
```

### 1.4 退出 psql 交互模式

输入 `\q` 或按 `Ctrl+D`。

> **提示**：所有命令在 `digital-employees/` 目录下执行。如果 `compose.sh` 不可用，可直接用 `docker exec digital-employees-v01-postgres-1 psql -U <user> -d <db> -c "..."`。

### 1.5 认证方式说明

上述所有命令通过 `compose.sh exec` 在 postgres 容器内部执行，psql 走本地 Unix socket，`pg_hba.conf` 对 local 连接配置为 `trust` 认证，**无需输入密码**。

`.env` 中的 `DB_PASSWORD` 仅用于**其他容器**（keycloak、platform-api）通过 TCP 远程连接 postgres，走 `scram-sha-256` 认证。

如果需要**带密码连接**（例如从宿主机或其他容器通过 TCP 访问），使用以下方式：

```bash
# 方式一：通过 PGPASSWORD 环境变量（推荐，避免密码出现在命令行历史）
PGPASSWORD='Horse~test@2026' psql -h 127.0.0.1 -p 5432 -U platform -d platform -c "SELECT 1;"

# 方式二：交互式提示输入密码（不暴露在命令行）
psql -h 127.0.0.1 -p 5432 -U platform -d platform
# 回车后提示：Password for user platform:

# 方式三：在容器内通过 TCP 连接（模拟其他容器的连接方式）
./tools/compose.sh exec -T postgres \
  sh -c "PGPASSWORD='Horse~test@2026' psql -h 127.0.0.1 -U platform -d platform -c 'SELECT 1;'"
```

> **注意**：默认 postgres 端口未在 `compose.yml` 中映射到宿主机。方式一、二需要先在 `compose.yml` 的 postgres 服务中添加 `ports: ["5432:5432"]` 并重启。方式三在容器内执行，无需映射端口。
>
> 密码值即 `.env` 中的 `DB_PASSWORD`，两个数据库用户（`platform`、`keycloak`）使用相同密码。

---

## 2. Platform 库（26 张表）

### 2.1 表总览

| 分类 | 表名 | 说明 |
|------|------|------|
| **组织架构** | `iam_domain` | 业务域 |
| | `iam_department` | 部门 |
| | `iam_team` | 团队 |
| | `iam_org_node` | 组织树节点（域/部门/团队统一建模） |
| | `iam_org_closure` | 组织树闭包表（祖先-后代关系） |
| | `iam_org_type` | 组织类型定义 |
| **用户** | `iam_principal` | 平台用户主体 |
| | `iam_principal_org` | 用户-组织节点多对多 |
| | `iam_sync_operation` | IAM 目录同步操作记录 |
| **权限** | `role_assignment` | 角色分配 |
| | `role_assignment_department` | 部门级角色范围 |
| | `scoped_role_assignment` | 细粒度范围角色 |
| | `permission_definition` | 权限定义 |
| | `custom_role` | 自定义角色 |
| | `custom_role_permission` | 自定义角色-权限关联 |
| **工作台接入** | `enrollment_request` | 工作台注册申请 |
| | `enrollment_challenge` | 注册挑战码 |
| | `machine_credential` | 机器凭证 |
| | `workbench_instance` | 工作台实例 |
| | `workbench_package` | 安装包 |
| **系统** | `audit_event` | 审计事件 |
| | `bff_session` | BFF 会话 |
| | `platform_setting` | 平台配置 |
| | `used_jti` | 已用 JWT ID（防重放） |
| | `problem_feedback` | 问题反馈 |
| | `alembic_version` | 数据库迁移版本 |

### 2.2 关键表字段说明

#### iam_domain — 业务域

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(64) | 域 ID（主键） |
| name | varchar(200) | 域名称 |
| status | varchar(20) | 状态（ACTIVE） |
| synced_at | timestamptz | 同步时间 |

#### iam_department — 部门

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(64) | 部门 ID（主键） |
| domain_id | varchar(64) | 所属域（外键 -> iam_domain.id） |
| name | varchar(200) | 部门名称 |
| status | varchar(20) | 状态 |
| synced_at | timestamptz | 同步时间 |

#### iam_team — 团队

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(64) | 团队 ID（主键） |
| department_id | varchar(64) | 所属部门（外键 -> iam_department.id） |
| name | varchar(200) | 团队名称 |
| status | varchar(20) | 状态 |
| synced_at | timestamptz | 同步时间 |

#### iam_org_node — 组织树节点

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(64) | 节点 ID（主键） |
| keycloak_group_id | varchar(64) | 对应 Keycloak group ID（唯一） |
| domain_id | varchar(64) | 所属域 |
| parent_id | varchar(64) | 父节点（外键自引用） |
| org_code | varchar(100) | 组织编码 |
| org_type | varchar(40) | 类型（DOMAIN / DEPARTMENT / TEAM） |
| name | varchar(200) | 名称 |
| status | varchar(20) | 状态 |
| sort_order | integer | 排序 |
| version | integer | 乐观锁版本 |
| synced_at | timestamptz | 同步时间 |

#### iam_principal — 用户主体

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(36) | 用户 ID（主键，UUID） |
| issuer | varchar(500) | OIDC issuer |
| subject | varchar(200) | OIDC subject |
| username | varchar(200) | 用户名 |
| display_name | varchar(200) | 显示名 |
| email | varchar(320) | 邮箱（可空） |
| domain_id | varchar(64) | 所属域 |
| department_id | varchar(64) | 所属部门（可空） |
| team_id | varchar(64) | 所属团队（可空） |
| status | varchar(20) | 状态（ACTIVE） |
| keycloak_user_id | varchar(64) | Keycloak user ID（唯一，可空） |
| primary_org_id | varchar(64) | 主组织节点（可空） |
| authorization_version | integer | 授权版本号 |
| synced_at | timestamptz | 同步时间 |

#### role_assignment — 角色分配

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(36) | 分配 ID（主键） |
| principal_id | varchar(36) | 用户（外键 -> iam_principal.id） |
| role_code | varchar(40) | 角色代码（SYSTEM_ADMIN / PLATFORM_ADMIN / SECURITY_ADMIN / AUDIT_ADMIN / DEPARTMENT_ADMIN / EMPLOYEE） |
| scope_type | varchar(40) | 范围类型（GLOBAL / ALL_DEPARTMENTS / DEPARTMENT_SET / SELF） |
| domain_id | varchar(64) | 域范围（可空） |
| status | varchar(20) | 状态（ACTIVE / REVOKED） |
| created_by | varchar(36) | 创建者 |
| created_at | timestamptz | 创建时间 |
| revoked_by | varchar(36) | 撤销者（可空） |
| revoked_at | timestamptz | 撤销时间（可空） |

#### audit_event — 审计事件

| 列 | 类型 | 说明 |
|----|------|------|
| id | varchar(36) | 事件 ID（主键） |
| event_type | varchar(80) | 事件类型（LOGIN_SUCCEEDED / LOGOUT_SUCCEEDED / AUTHENTICATION_FAILED / BACKCHANNEL_LOGOUT 等） |
| category | varchar(20) | 分类（AUTH / IAM / ENROLLMENT 等） |
| actor_type | varchar(20) | 操作者类型（USER / SYSTEM / SERVICE） |
| actor_id | varchar(100) | 操作者 ID（可空） |
| target_type | varchar(40) | 目标类型 |
| target_id | varchar(100) | 目标 ID（可空） |
| result | varchar(20) | 结果（SUCCESS / FAILURE） |
| summary | varchar(500) | 摘要描述 |
| occurred_at | timestamptz | 发生时间 |

### 2.3 常用查询

#### 查看所有表和行数

```sql
SELECT relname AS table_name, n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC, relname;
```

#### 查看用户及其角色

```sql
SELECT p.username, p.display_name, r.role_code, r.scope_type, r.status
FROM iam_principal p
LEFT JOIN role_assignment r ON r.principal_id = p.id AND r.status = 'ACTIVE'
ORDER BY p.username;
```

#### 查看组织树（层级结构）

```sql
SELECT org_code, org_type, name, parent_id, sort_order
FROM iam_org_node
WHERE status = 'ACTIVE'
ORDER BY sort_order;
```

#### 查看部门及其下属团队

```sql
SELECT d.name AS department, t.name AS team
FROM iam_department d
LEFT JOIN iam_team t ON t.department_id = d.id
ORDER BY d.name, t.name;
```

#### 查看用户所属域/部门/团队

```sql
SELECT p.username, p.display_name,
       dom.name AS domain,
       dept.name AS department,
       team.name AS team
FROM iam_principal p
JOIN iam_domain dom ON dom.id = p.domain_id
LEFT JOIN iam_department dept ON dept.id = p.department_id
LEFT JOIN iam_team team ON team.id = p.team_id
ORDER BY p.username;
```

#### 查看最近审计事件

```sql
SELECT event_type, category, actor_id, summary, result, occurred_at
FROM audit_event
ORDER BY occurred_at DESC
LIMIT 20;
```

#### 查看活跃 BFF 会话

```sql
SELECT p.username, s.created_at, s.expires_at
FROM bff_session s
JOIN iam_principal p ON p.id = s.principal_id
WHERE s.expires_at > now()
ORDER BY s.expires_at DESC;
```

#### 查看工作台注册申请

```sql
SELECT er.id, p.username, er.status, er.created_at, er.review_reason
FROM enrollment_request er
JOIN iam_principal p ON p.id = er.principal_id
ORDER BY er.created_at DESC;
```

#### 查看迁移版本

```sql
SELECT * FROM alembic_version;
```

---

## 3. Keycloak 库（100 张表）

Keycloak 使用标准 schema，日常排查通常只需关注以下表。

### 3.1 关键表

| 表名 | 说明 |
|------|------|
| `realm` | Realm 定义（master + digital-employees） |
| `client` | 客户端定义（platform-web / workbench-desktop / platform-iam-sync 等） |
| `client_attributes` | 客户端属性（重定向 URI、PKCE 等） |
| `redirect_uris` | 客户端重定向 URI |
| `web_origins` | 客户端允许的 Origin |
| `user_entity` | 用户 |
| `credential` | 用户凭证（密码哈希等） |
| `user_attribute` | 用户属性（domain_id / department_id / team_id / primary_org_id） |
| `keycloak_group` | 组（组织架构） |
| `user_group_membership` | 用户-组关系 |
| `keycloak_role` | 角色定义 |
| `user_role_mapping` | 用户-角色映射 |
| `client_scope` | 客户端 Scope（organization-context） |
| `protocol_mapper` | Token 映射器（claim 映射规则） |

### 3.2 常用查询

#### 查看 Realm

```sql
SELECT id, name, enabled FROM realm;
```

#### 查看客户端及 secret

```sql
SELECT client_id, enabled, public_client, secret
FROM client
WHERE client_id IN ('platform-web', 'platform-iam-sync', 'workbench-desktop');
```

> `secret` 字段值应与 `tools/.env` 中 `OIDC_CLIENT_SECRET` / `IAM_SYNC_CLIENT_SECRET` 一致。

#### 查看用户

```sql
SELECT username, enabled, email
FROM user_entity
WHERE realm_id = (SELECT id FROM realm WHERE name = 'digital-employees')
ORDER BY username;
```

#### 查看用户组织属性

```sql
SELECT u.username, ua.name, ua.value
FROM user_attribute ua
JOIN user_entity u ON u.id = ua.user_id
WHERE ua.name IN ('domain_id', 'department_id', 'team_id', 'primary_org_id')
ORDER BY u.username, ua.name;
```

#### 查看组（组织架构）

```sql
SELECT name FROM keycloak_group ORDER BY name;
```

#### 查看用户-组关系

```sql
SELECT u.username, g.name AS group_name
FROM user_group_membership ugm
JOIN user_entity u ON u.id = ugm.user_id
JOIN keycloak_group g ON g.id = ugm.group_id
ORDER BY u.username, g.name;
```

#### 查看客户端重定向 URI

```sql
SELECT c.client_id, ru.uri
FROM redirect_uris ru
JOIN client c ON c.id = ru.client_id
WHERE c.client_id IN ('platform-web', 'workbench-desktop');
```

#### 查看用户角色映射

```sql
SELECT u.username, r.name AS role_name
FROM user_role_mapping urm
JOIN user_entity u ON u.id = urm.user_id
JOIN keycloak_role r ON r.id = urm.role_id
ORDER BY u.username;
```

---

## 4. 实用技巧

### 4.1 查看任意表结构

```bash
./tools/compose.sh exec -T postgres psql -U platform -d platform -c "\d iam_principal"
```

### 4.2 导出查询结果为 CSV

```bash
./tools/compose.sh exec -T postgres psql -U platform -d platform \
  -c "\copy (SELECT username, display_name, status FROM iam_principal) TO STDOUT WITH CSV HEADER"
```

### 4.3 统计各表行数

```bash
./tools/compose.sh exec -T postgres psql -U platform -d platform -c "
  SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
"
```

### 4.4 跨库查询

两个数据库在同一 PostgreSQL 实例但不同 schema，无法直接 JOIN。如需关联 platform 和 keycloak 数据，分别在两个库查询后人工对照。

platform 的 `iam_principal.keycloak_user_id` 对应 keycloak 的 `user_entity.id`，可作为关联键。

```sql
-- platform 库
SELECT username, keycloak_user_id FROM iam_principal;

-- keycloak 库（用上面查到的 keycloak_user_id）
SELECT username, email FROM user_entity WHERE id = '<keycloak_user_id>';
```
