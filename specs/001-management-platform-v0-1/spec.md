# Feature Spec: 管理平台 V0.1

**Feature Branch**: `001-management-platform-v0-1`
**Created**: 2026-08-15
**Input**: 实现完整管理平台 V0.1、最小工作台认证 Demo、Keycloak IAM 与真实端到端测试。

## Problem Statement

组织目前没有可运行的软件来让企业人员登录、按固定角色管理工作台，并以可审计、可撤销的机器身份完成工作台可信接入。现有仓库只有需求、设计和原型，无法执行真实登录、审批、密钥证明、机器认证和心跳闭环。

## Goals

- 交付可由 Docker Compose 启动的 Keycloak、PostgreSQL、管理平台和最小工作台 Demo。
- 实现当前基线冻结的十项 V0.1 验收标准，不增加目标态功能。
- 以真实服务和真实协议完成自动化端到端测试，不模拟 IAM、数据库、OIDC 或机器认证。
- 保持人员身份、工作台私钥和机器 Token 相互独立。

## Non-goals

- 数字员工、Team、任务、Workflow、成本、评价、市场和运行观测。
- 自定义角色、ABAC、显式 deny、团队级授权和组织主数据编辑。
- 设备资产、设备转交、命令/ACK、更新推送、灰度发布和回退。
- DPoP、mTLS、TPM、MDM、远程证明、自动审批和风险评分。
- 工作台的实际业务功能、桌面安装器和生产级多节点高可用。

## Primary User Flow (Happy Path)

1. 匿名访问者在公开首页查看并下载已发布安装包。
2. 员工通过工作台打开系统浏览器，在 Keycloak 完成 OIDC Authorization Code + PKCE 登录。
3. 工作台生成 `installation_id` 和 ES256 密钥，提交本人接入申请。
4. 系统管理员或平台管理员登录管理平台并批准申请。
5. 工作台获取一次性 challenge，以本机私钥签名并完成实例注册。
6. 工作台使用 `private_key_jwt` 获取短期机器 Token 并发送首次心跳。
7. 有权限的管理员按数据范围查看工作台和审计，并可撤销接入。

## User Stories (prioritized)

### P1 — 人员安全登录并获得正确权限

作为 IAM 预置人员，我希望使用企业账号登录管理平台或工作台，并且只看到角色和数据范围允许的资源。

**Acceptance Scenarios**:
1. **Given** Keycloak 中存在有效人员，**When** 其通过管理平台 Authorization Code 登录，**Then** 平台建立 BFF 会话并按 `(issuer, sub)` 返回身份、角色和数据范围。
2. **Given** 员工或范围管理员已登录，**When** 其请求列表、详情或直接构造越权 API，**Then** 服务端只返回本人或授权部门数据，越权操作返回 403 并审计。
3. **Given** 系统管理员管理角色授权，**When** 其尝试撤销最后一个有效系统管理员，**Then** 请求失败且原授权保持有效。

### P1 — 工作台完成可信接入和撤销

作为员工，我希望工作台经本人登录、管理员审批和私钥证明后获得独立机器身份；作为管理员，我希望能立即撤销该身份。

**Acceptance Scenarios**:
1. **Given** 工作台已通过真实 Keycloak PKCE 登录，**When** 提交申请、管理员批准、完成 challenge 签名、申请机器 Token 并心跳，**Then** 平台创建唯一实例并显示首次及最后心跳。
2. **Given** 重复申请或完成请求，**When** 相同幂等身份再次提交，**Then** 返回原申请或实例且不产生重复记录。
3. **Given** challenge 过期、重放、nonce/audience/签名错误或无审批权限，**When** 调用对应 API，**Then** 请求失败并生成不含敏感材料的审计事件。
4. **Given** 已接入工作台持有尚未过期的机器 Token，**When** 系统或平台管理员撤销实例，**Then** 新 Token 签发和旧 Token 心跳都立即失败。

### P1 — 管理员管理工作台安装包

作为匿名访问者，我希望无需登录即可下载当前发布包；作为系统或平台管理员，我希望管理发布状态。

**Acceptance Scenarios**:
1. **Given** 存在草稿、已发布和已下架安装包，**When** 匿名用户访问首页或公开 API，**Then** 只看到并能下载已发布包及其版本、OS、架构、大小、SHA-256 和签名状态。
2. **Given** 系统或平台管理员已登录，**When** 上传、发布或下架包，**Then** 状态立即反映到公开首页并写入审计。
3. **Given** 其他角色已登录或匿名访问者直接调用管理 API，**When** 尝试上传、发布或下架，**Then** 返回 401/403 且不改变数据。

### P2 — 管理员配置权限、审计和最小设置

作为系统或平台管理员，我希望维护 V0.1 必需配置；作为有审计权限的管理员，我希望按角色和部门范围查看事件。

**Acceptance Scenarios**:
1. **Given** 系统管理员已登录，**When** 为 IAM 人员绑定固定角色和域/部门范围，**Then** 权限即时生效并记录审计；平台管理员不得配置角色。
2. **Given** 不同管理员拥有不同审计权限和范围，**When** 查询审计，**Then** 只返回允许的事件类型和发生时域/部门快照。
3. **Given** 系统或平台管理员已登录，**When** 修改允许的 V0.1 设置，**Then** 设置被校验、持久化并审计；其他角色不得修改。

## Requirements

### Functional

- **FR-001**: 管理平台 Web 必须采用 Keycloak OIDC Authorization Code + BFF 服务端会话。
- **FR-002**: 工作台必须采用系统浏览器、Authorization Code + PKCE S256 和 loopback 回调，不保存 Client Secret。
- **FR-003**: 平台必须按 `(issuer, sub)` 建立稳定人员映射并只读同步 Keycloak 域、部门、团队和人员。
- **FR-004**: 必须实现六种固定角色及 `GLOBAL`、`ALL_DEPARTMENTS`、`DEPARTMENT_SET`、`SELF` 数据范围。
- **FR-005**: 仅系统管理员可配置角色和范围，且不得撤销最后一个有效系统管理员。
- **FR-006**: 匿名用户可查看和下载 `PUBLISHED` 包；仅系统/平台管理员可上传、发布和下架。
- **FR-007**: 接入必须实现本人申请、人工批准/拒绝、5 分钟一次性 challenge、ES256 持钥证明和幂等实例创建。
- **FR-008**: 机器认证必须使用 `private_key_jwt`，签发最长 5 分钟且仅有 `workbench.heartbeat` scope 的 Token。
- **FR-009**: 心跳必须校验 Token、路径 subject、scope 及实例/凭证实时状态，并由服务器时间计算在线状态。
- **FR-010**: 仅系统/平台管理员可撤销；撤销后新旧机器 Token 均不能访问心跳。
- **FR-011**: 必须提供公开首页、总览、工作台、接入申请、审计、安装包、权限配置和平台设置页面。
- **FR-012**: 必须审计登录、授权、包管理、接入、认证失败、首次心跳、撤销和越权事件，且不记录敏感凭证。
- **FR-013**: 平台设置仅包括 OIDC、公开 base URL、challenge/Token 时效、离线阈值和包存储/下载配置。
- **FR-014**: 工作台 Demo 只实现登录、接入状态、机器认证和心跳控制，不实现业务功能。

### Non-functional

- **NFR-001**: 所有列表、详情和操作 API 都必须在服务端执行功能权限与数据范围检查。
- **NFR-002**: challenge、接入完成和 JWT `jti` 必须防重放；并发完成最多创建一个实例。
- **NFR-003**: 密码、Cookie、人员/机器 Token、私钥、Authorization Code、PKCE verifier、challenge 明文和完整 JWS 不得进入日志或审计。
- **NFR-004**: 本地开发允许 `localhost` HTTP；非本地配置必须要求 HTTPS URL。
- **NFR-005**: `tools/test-e2e.sh` 必须以真实 Keycloak、PostgreSQL、平台和工作台进程运行，禁止 mock、stub 或预置业务结果绕过主链。
- **NFR-006**: 后端单元/集成测试、前端测试和 E2E 必须可重复运行；E2E 失败保留 Playwright trace。
- **NFR-007**: 使用当前环境 Python 3.11.6、Node.js 22.22.0 和 Java 17；环境不存在的服务使用最新稳定容器版本并固定镜像标签。
- **NFR-008**: 验收环境必须以单一显式 `PUBLIC_HOST` 作为公开地址配置源，所有浏览器可见 OIDC 地址、回调和跨应用链接由它派生，不得在代码中硬编码部署 IP。
- **NFR-009**: 验收环境所有预置人员账号和 Keycloak 管理员必须使用默认密码 `Horse~test@2026`；内部数据库不暴露宿主端口并使用同一强默认密码。

## Edge Cases

- IAM 人员不存在、停用、issuer/audience 不匹配或平台尚未建立映射。
- 多角色范围合并但不得跨越授权域；客户端筛选只能缩小服务端范围。
- 同版本、OS、架构重复发布；已下架包 URL 再次访问。
- 审批后申请人停用；challenge 过期、重复消费或并发完成。
- `private_key_jwt` 的算法、audience、时间、签名或 `jti` 非法。
- 机器 Token subject 与心跳路径不一致，或实例/凭证已经撤销。
- 包上传中断、摘要不匹配、非法文件名和超限文件。

## Success Criteria (measurable)

- **SC-001**: 当前需求文档十项验收标准全部有自动化验证并通过。
- **SC-002**: 一条命令从空数据库启动全栈并完成真实成功主链 E2E。
- **SC-003**: 关键失败场景至少覆盖越权、challenge 重放/错误签名和撤销后旧 Token 心跳失败。
- **SC-004**: 自动化检查确认审计和应用日志中不包含测试所使用的 Token、私钥或 challenge 明文。
- **SC-005**: 重复申请和并发/重复完成均只产生一个对应业务对象。
- **SC-006**: 至少使用两个不同 `PUBLIC_HOST` 值解析 Compose 配置并得到一致派生 URL；使用当前虚拟机地址完成管理平台和工作台真实 OIDC 登录。

## Assumptions

- V0.1 采用单机 Docker Compose 作为开发和验收部署，不声明生产高可用。
- Keycloak 组织层次以组和属性表示；平台通过服务账号调用 Admin API 做只读同步。
- 安装包文件在 V0.1 使用受控本地卷保存，元数据和访问控制在平台中实现，不引入 MinIO。
- 测试账号和组织数据由 Realm 导入生成；测试通过真实 Keycloak 页面输入凭据，不伪造 Token。
- 用户已在 2026-08-16 明确允许将必要规格、设计和 Agent 交接上下文归档到当前仓库，该指令取代之前的仅代码提交限制。

## Open Questions

- 无。
