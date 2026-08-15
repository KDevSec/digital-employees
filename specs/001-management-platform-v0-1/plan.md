# Plan: 管理平台 V0.1

**Feature Branch**: `001-management-platform-v0-1`
**Date**: 2026-08-15
**Spec**: `/specs/001-management-platform-v0-1/spec.md`

## Summary

在现有空代码目录中建立可由 Docker Compose 启动的管理平台、Keycloak IAM、PostgreSQL 和最小工作台 Demo。平台实现完整 V0.1 权限、包管理、可信接入、机器认证、心跳、撤销、审计与设置；工作台只实现真实登录和接入演示；Playwright 驱动完整真实 E2E。

## Technical Context (repo scan)

- **Stack**: Python 3.11.6、FastAPI 0.137.x、SQLAlchemy 2、Alembic、PostgreSQL 18.4；Node.js 22.22.0、Vue 3.5、Vite 8、TypeScript、Vitest、Playwright 1.62；Keycloak 26.7。
- **Key modules/files**: `platform/backend/app/`、`platform/frontend/src/`、`workbench/src/`、`iam/realm/`、`tools/compose.yml`、`tools/runtime-env.sh`、`tools/sync-keycloak-urls.sh`、`tools/e2e/`。
- **Constraints**: 保留现有用户内容；当前仓库允许归档必要规格和上下文；V0.1 私网验收允许 HTTP，公网部署必须使用 HTTPS。

## Approach (mapped to primary user flow)

1. 通过 Realm 导入建立真实用户、组织组和两个 OIDC Client；平台首次登录同步人员并建立 BFF 会话。
2. 平台公开首页从数据库读取 `PUBLISHED` 包，匿名提供受控流式下载；管理员页面执行上传、发布和下架。
3. 工作台在本地生成并持久化 ES256 私钥与 installation ID，通过系统浏览器完成 PKCE 并提交申请。
4. 平台管理员批准后，工作台获取 challenge、签名 proof；平台事务性消费 challenge 并创建实例和凭证。
5. 工作台使用私钥 assertion 换取平台签发的短期机器 Token，发送真实心跳。
6. 平台按角色和范围展示工作台、申请和审计；撤销后每次机器调用的数据库状态检查立即拒绝旧 Token。
7. 启动工具加载显式 `PUBLIC_HOST` 或 `tools/.env`，Compose 与 Realm 导入使用同一变量；Keycloak 启动后同步已有 Client 的 Redirect URI/Web Origin。

## Interfaces / APIs

- `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/v1/me`: BFF 登录会话。
- `GET /.well-known/workbench-configuration`: 返回真实平台、OIDC、接入和 Token 地址。
- `GET /api/v1/public/workbench-packages`, `GET /api/v1/public/workbench-packages/{id}/download`: 匿名已发布包。
- `GET/POST/DELETE /api/v1/role-assignments`: 查询、授予、撤销固定角色。
- `GET/POST /api/v1/admin/workbench-packages`, `POST .../{id}/publish|withdraw`: 包管理。
- `POST/GET /api/v1/workbench-enrollments`, `POST .../{id}/approve|reject|challenge|complete`: 接入状态机。
- `POST /oauth2/workbench/token`: 校验 form-urlencoded private key assertion，返回短期 Bearer Token。
- `POST /api/v1/workbenches/{id}/heartbeat`, `GET /api/v1/workbenches[/{id}]`, `POST .../{id}/revoke`: 心跳、范围查询和撤销。
- `GET /api/v1/audit-events`, `GET/PUT /api/v1/platform-settings`: 审计与设置。
- 所有错误返回 `{ "error": { "code": string, "message": string, "trace_id": string } }`，不暴露凭证或对象存在性细节。

## Data Model / Migrations

- IAM 快照：`iam_domain`、`iam_department`、`iam_team`、`iam_principal`，`issuer + subject` 唯一。
- 授权：`role_assignment`、`role_assignment_department`，活动授权去重并保护最后一个系统管理员。
- 包：`workbench_package`，同 `version + os + arch` 只有一个已发布记录。
- 接入：`enrollment_request`、`enrollment_challenge`、`workbench_instance`、`machine_credential`，唯一约束保障幂等。
- 安全状态：`used_jti` 记录 assertion/proof 的短时防重放数据。
- 平台基础：`bff_session`、`audit_event`、`platform_setting`。
- 第一份 Alembic migration 一次建立 V0.1 schema；不创建后续版本占位表。

## Security / Privacy

- BFF Cookie 为 HttpOnly、SameSite=Lax；生产配置启用 Secure；会话只在 PostgreSQL 保存 opaque ID 的哈希。
- OIDC 校验 state、nonce、issuer、audience、签名和时间；工作台额外校验 PKCE。
- 只接受 P-256/ES256；JWK 指纹由服务端计算；challenge 存哈希；JWT 固定 issuer/audience/算法。
- 查询在 SQL 层注入数据范围；详情和操作重新鉴权；资源范围不采信请求体。
- 日志过滤 Authorization、Cookie、JWT、私钥、challenge 和 PKCE verifier。
- 登录、challenge、complete 和 token 端点使用数据库窗口计数实现最小限速。

## Observability

- JSON 结构化日志包含时间、级别、事件、trace ID、路由、状态和耗时，不含敏感字段。
- HTTP 响应返回 `X-Trace-Id`；审计事件复用 trace ID 串联业务链。
- 健康端点分别报告进程和数据库可用性；Compose 使用健康检查排序启动。

## Test Strategy (map to acceptance scenarios)

- P1 登录场景 → pytest OIDC/session 集成测试 + Playwright 真实 Keycloak 管理平台登录。
- P1 数据范围/最后管理员 → pytest 参数化六角色范围测试 + Playwright 直接 API 越权验证。
- P1 接入成功 → Playwright 操作真实工作台 UI、Keycloak、管理员 UI，并校验数据库/API 最终状态。
- P1 接入幂等与异常 → pytest 并发事务测试；Playwright/API 使用真实密钥验证重放、错误签名与无权限审批。
- P1 包管理 → Playwright 真实上传临时二进制、发布、匿名下载、摘要比对、下架后 404。
- P2 权限/审计/设置 → pytest 权限矩阵与审计脱敏；Playwright 跨角色验证页面/API。
- 撤销 → 先真实取得机器 Token，再由管理员撤销，并用同一旧 Token 请求心跳确认 401/403。
- 测试禁止替换 Keycloak、数据库、HTTP 或密码学实现；单元测试可隔离纯函数，但验收必须由 Compose E2E 重走真实主链。
- 物理机访问场景 → 使用两个不同 `PUBLIC_HOST` 值执行真实 Compose 插值测试；Playwright 通过当前 `PUBLIC_HOST` 完成真实 Keycloak 登录并断言回调主机。

## Rollout Plan (if user-facing)

1. `tools/up.sh` 加载公开地址、构建镜像并启动依赖。
2. 平台容器自动执行 Alembic migration 和安全的首个系统管理员绑定。
3. `tools/up.sh` 通过 `wait-for-http.sh` 验证 Keycloak discovery、平台 health 和工作台 health，再同步 OIDC Client URL。
4. `tools/test-e2e.sh` 清空专用测试卷后启动测试栈并执行全部 E2E。
5. 生产部署前替换密钥、域名、Redirect URI 和测试用户，并启用 HTTPS/Secure Cookie。
6. 当前人工验收在 `tools/.env` 设置 `PUBLIC_HOST=192.168.153.128`，统一使用 `Horse~test@2026`，不修改宿主机网络或防火墙设置。
7. 后续生产采用稳定 DNS 名称、HTTPS 反向代理、固定 Keycloak hostname 与可信代理头；详见部署设计文档，当前不实现。

## Risks + Mitigations

- Keycloak 启动和 Realm 导入存在时序 → 健康检查加显式 discovery 轮询，测试不使用固定 sleep。
- OIDC 浏览器、BFF 和 loopback 三方跳转易出错 → 使用固定测试 host 映射和逐跳断言，保留 Playwright trace。
- 防重放/幂等存在并发竞态 → PostgreSQL 唯一约束和事务行锁作为最终保障，并运行并发测试。
- E2E 误用种子结果导致假通过 → 测试每次生成唯一 installation ID、ES256 密钥和包内容，并断言产生的新 ID/摘要。
- 当前环境缺 Compose 插件或依赖 → 优先 dnf 安装；不存在时下载并固定最新稳定二进制，脚本在执行前报告版本。
- 运行中修改 `PUBLIC_HOST` 但 Realm 导入跳过已有 Realm → `tools/up.sh` 在 Keycloak 就绪后通过 Admin API 幂等同步两个 OIDC Client。

## Assumptions (if needed)

- 公开安装包文件使用平台本地持久卷；“对象存储配置”在 V0.1 表示包根目录和公开下载基址。
- E2E 使用测试 Realm 的真实预置账号，测试数据可由测试 API/界面创建，但业务结果不得预写入数据库。
