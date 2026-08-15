# Tasks: 管理平台 V0.1

**Spec**: `/specs/001-management-platform-v0-1/spec.md`
**Decisions**: `/specs/001-management-platform-v0-1/decisions.md`
**Plan**: `/specs/001-management-platform-v0-1/plan.md`

## Instructions

- 每项实现执行 RED → GREEN → REFACTOR，并保存首次失败和最终通过结果。
- 任务完成后勾选；按 2026-08-16 用户指令归档本规格目录、部署设计和 Agent 交接上下文。
- E2E 必须使用真实 Keycloak、PostgreSQL、HTTP 服务和即时生成的密钥/数据。

## P1 — 人员安全登录并获得正确权限

### Acceptance Scenario 1：真实 OIDC 与 BFF 会话
- [x] [Impl] 在 `iam/realm/` 定义 Realm、组织、用户及管理平台/工作台 Client；在 `platform/backend/app/auth/` 实现 discovery、登录、callback、logout 和数据库会话。
- [x] [Verify] 在 `platform/backend/tests/auth/` 先写失败测试，再用真实 Keycloak 集成测试验证 issuer/sub 映射、state/nonce 和会话 Cookie。
- [x] [Impl] 在 `platform/frontend/src/features/session/` 实现登录入口、当前用户和退出交互。
- [x] [Verify] 在 `tools/e2e/tests/auth.spec.ts` 通过真实 Keycloak 登录页验证管理员和员工登录/退出。

### Acceptance Scenario 2：固定角色和数据范围
- [x] [Impl] 在 `platform/backend/app/authorization/` 实现固定权限映射、SQL 查询范围和详情/操作守卫。
- [x] [Verify] 在 `platform/backend/tests/authorization/` 参数化覆盖六角色、四范围、范围并集和越权审计。
- [x] [Impl] 在 `platform/frontend/src/router/` 和布局组件中按 `/api/v1/me` 控制导航与动作可见性。
- [x] [Verify] 在 `tools/e2e/tests/scope.spec.ts` 以真实不同账号验证 UI 与直接 API 均不能越权。

### Acceptance Scenario 3：保护最后一个系统管理员
- [x] [Impl] 在 `platform/backend/app/authorization/role_assignments.py` 以事务锁实现授权创建/撤销和最后管理员保护。
- [x] [Verify] 在 `platform/backend/tests/authorization/test_role_assignments.py` 验证多个管理员、撤销即时生效和最后管理员失败。

## P1 — 工作台完成可信接入和撤销

### Acceptance Scenario 1：成功主链
- [x] [Impl] 在 `workbench/src/` 实现本地状态、ES256 密钥、PKCE 登录、申请、轮询、challenge proof、private_key_jwt 和心跳。
- [x] [Verify] 在 `workbench/tests/` 先写密钥、PKCE 和状态转换失败测试，再实现最小代码通过。
- [x] [Impl] 在 `platform/backend/app/enrollment/` 和 `machine_auth/` 实现申请、审批、challenge、complete、Token 和心跳事务。
- [x] [Verify] 在 `platform/backend/tests/enrollment/` 逐接口完成 RED/GREEN 集成测试。
- [x] [Impl] 在 `platform/frontend/src/features/enrollments/` 与 `workbenches/` 实现待审、批准/拒绝、列表、详情和撤销页面。
- [x] [Verify] 在 `tools/e2e/tests/enrollment.spec.ts` 从工作台真实登录开始完成审批、持钥证明、Token 和首次心跳。

### Acceptance Scenario 2：幂等与并发
- [x] [Impl] 为申请、challenge 消费、实例创建和首次心跳增加唯一约束、事务锁与稳定幂等响应。
- [x] [Verify] 在 `platform/backend/tests/enrollment/test_idempotency.py` 并发提交并断言只创建一个申请和实例。

### Acceptance Scenario 3：错误证明与越权
- [x] [Impl] 增加稳定错误码、防重放 `used_jti`、长度/时间窗口限制和失败审计。
- [x] [Verify] 在 `platform/backend/tests/enrollment/test_security.py` 使用真实生成的不同密钥、过期 JWT 和重复 JWT 验证拒绝路径。
- [x] [Verify] 在 `tools/e2e/tests/enrollment-errors.spec.ts` 验证无权审批和 challenge 重放产生真实失败与审计。

### Acceptance Scenario 4：撤销立即生效
- [x] [Impl] 在一个事务中撤销实例和凭证；Token 与心跳端点每次读取当前状态。
- [x] [Verify] 在 `tools/e2e/tests/revocation.spec.ts` 保存撤销前真实 Token，撤销后验证新 Token 与旧 Token 心跳均失败。

## P1 — 管理员管理工作台安装包

### Acceptance Scenario 1：匿名只见已发布包
- [x] [Impl] 在 `platform/backend/app/packages/` 实现元数据、受控文件存储、公开列表和流式下载。
- [x] [Verify] 在 `platform/backend/tests/packages/` 验证三状态可见性、下载摘要和非法路径。
- [x] [Impl] 在 `platform/frontend/src/features/public/` 实现无需登录的首页、包信息和下载入口。
- [x] [Verify] 在 `tools/e2e/tests/packages.spec.ts` 匿名访问并校验实际下载字节与 SHA-256。

### Acceptance Scenario 2：管理员上传、发布和下架
- [x] [Impl] 实现包上传、摘要计算、发布唯一约束、下架及管理页面。
- [x] [Verify] Playwright 生成随机包文件，经管理员 UI 上传和发布，匿名下载后再下架并验证不可访问。

### Acceptance Scenario 3：包管理越权
- [x] [Impl] 对所有包管理 API 应用 `package.manage` 服务端权限并审计失败。
- [x] [Verify] 参数化 API 和 Playwright 测试匿名、员工、范围管理员均不能改变包状态。

## P2 — 管理员配置权限、审计和最小设置

### Acceptance Scenario 1：权限配置
- [x] [Impl] 实现 Keycloak Admin API 只读同步、人员搜索、域/部门查询和权限配置页面。
- [x] [Verify] 使用真实 Keycloak 组/用户同步并验证系统管理员可配置、平台管理员被拒绝、权限即时生效。

### Acceptance Scenario 2：范围内审计
- [x] [Impl] 在 `platform/backend/app/audit/` 实现事件类型授权、快照范围、筛选和分页；在前端实现只读查询页。
- [x] [Verify] 创建跨域/部门真实事件，以五类管理员查询并断言无越权和无敏感字段。

### Acceptance Scenario 3：最小平台设置
- [x] [Impl] 在 `platform/backend/app/settings/` 实现白名单键、类型/范围验证和更新审计；实现设置页面。
- [x] [Verify] 验证系统/平台管理员可更新、其他角色被拒绝、非法 URL/时效不落库。

## 工具与交付

- [x] [Impl] 在 `tools/compose.yml` 和 `tools/*.sh` 实现构建、启动、迁移、健康检查、清理测试栈与日志收集。
- [x] [Impl] 在 `tools/test-unit.sh`、`tools/test-integration.sh`、`tools/test-e2e.sh` 汇总自动化测试，任何阶段失败立即退出。
- [x] [Verify] 从空测试卷运行完整脚本两次，确认无顺序依赖且第二次不依赖第一次业务数据。
- [x] [Verify] 检查 Git 暂存区只包含代码、配置及用户已授权归档的规格/设计/交接文档，排除凭据、测试报告和运行数据。

## Final Verification

> 上方是规划阶段的细分 WBS，实际实现合并了部分测试目录与场景。以下新鲜的聚合验证和交接上下文为完成证据。

- [x] [Impl] 用显式 `PUBLIC_HOST`、本地 `.env` 和 Compose 插值替换硬编码 IP；Realm 初始导入使用占位符，启动后幂等同步已有 OIDC Client。
- [x] [Verify] 使用两个不同 `PUBLIC_HOST` 值验证所有公开 URL 一致派生，并从当前物理机可达地址完成真实管理平台与工作台 OIDC 登录。
- [x] [Docs] 记录方案三的 DNS、TLS、反向代理、Keycloak hostname 迁移方案及当前实现交接上下文。

- [x] Verify all acceptance scenarios
- [x] 运行后端全量测试、前端测试、工作台测试和真实 Compose E2E 并保存新鲜结果。
- [x] 检查日志和审计中不含测试 Token、私钥、challenge、密码或 Cookie；并禁止 Nginx 记录 OIDC callback 查询串。
- [x] 对照需求验收标准记录通过证据，详见交接上下文。
