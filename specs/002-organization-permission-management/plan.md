# Plan: 可配置组织树与分级权限管理

**Feature Branch**: `002-organization-permission-management`
**Date**: 2026-08-16
**Spec**: `/specs/002-organization-permission-management/spec.md`

## Summary

把 V0.1 固定的域、部门、团队快照升级为 Keycloak 驱动的通用组织树；在管理平台增加组织与人员管理、系统权限点、自定义角色、人员/组织授权、双重下级继承、防越权委派、同步重试、全量对账和迁移验证。Keycloak 继续负责认证、用户、组织和成员关系，平台 PostgreSQL 负责业务授权和审计。

## Technical Context (repo scan)

- **Stack**: Keycloak 26.7、PostgreSQL 18、FastAPI、SQLAlchemy 2、Alembic、Pydantic、httpx、Vue 3、TypeScript、Vitest/Playwright、Docker Compose。
- **Current IAM source**: `iam/realm/digital-employees-realm.json` 定义示例 Group、用户属性和 OIDC mapper；现有 Group 未作为平台完整组织同步来源。
- **Backend models**: `platform/backend/app/models.py` 中的 `IamDomain`、`IamDepartment`、`IamTeam`、`IamPrincipal`、`RoleAssignment`、`RoleAssignmentDepartment` 是迁移入口。
- **IAM sync**: `platform/backend/app/auth/oidc.py` 当前仅从 Admin API 拉取最多 1,000 个用户并从用户属性构造固定层级快照，需要拆出分页、Group 树、Membership、增量同步与对账模块。
- **Authorization**: `platform/backend/app/domain/authorization.py` 当前固定六种角色和四种范围；`platform/backend/app/api/dependencies.py` 负责请求身份和权限入口。
- **Management APIs**: `platform/backend/app/api/core.py` 提供域、部门、人员读取；`platform/backend/app/api/roles.py` 提供固定角色授权 CRUD。
- **Frontend**: `platform/frontend/src/features/permissions/PermissionsPage.vue` 是固定角色权限页；需要增加组织管理、人员详情、角色编辑和授权预览。
- **Tests**: `platform/backend/tests/domain/test_authorization.py`、`test_oidc_principal_sync.py`、API tests 和 `tools/e2e/v01.spec.ts` 提供现有测试模式。
- **Constraints**: Keycloak 是组织人员唯一事实来源；平台不存密码；业务 API 授权必须服务端执行；维持模块化单体和现有 BFF；不得引入通用策略引擎或新微服务。

## Approach (mapped to primary user flow)

1. 增加组织类型、通用组织节点、闭包关系、人员组织关系、权限点、自定义角色、角色权限、通用角色授权、同步操作和授权版本数据模型；编写 V0.1 兼容迁移。
2. 把 Keycloak Admin API 访问封装为独立 IAM gateway，使用分页查询和幂等写入管理 Group、User、Membership 与 `primary_org_id`。
3. 实现组织同步服务：Keycloak 写入优先，成功后读取最新对象并事务更新平台快照、闭包关系、授权版本和审计；失败进入可重试同步操作表。
4. 实现全量对账任务，分页遍历 Keycloak Group/User/Membership，按 Keycloak 事实修复平台快照并输出差异摘要。
5. 实现组织 CRUD、同域移动、停用/恢复/归档、树懒加载和搜索 API，使用乐观版本与幂等键。
6. 实现人员 CRUD、状态、唯一主组织和多个协作组织 API；人员停用或高风险变更时失效授权缓存和 BFF 会话。
7. 用预定义权限目录和可配置角色替换固定权限映射；实现授权对象匹配、资源范围匹配、并集、有效期和组织闭包判断。
8. 在角色创建、修改和授权时执行权限子集、可委派标记、对象管辖和范围包含校验，保护最后一个全局系统管理员。
9. 为业务资源建立统一 `ResourceContext`，逐个迁移现有工作台、安装包、审计和设置 API 到新授权检查器。
10. 实现组织树、人员组织关系、角色编辑、授权向导、有效权限解释和同步状态界面。
11. 运行迁移权限对比、故障注入、Keycloak 集成、服务端越权矩阵、前端和真实 E2E 验收。

## Interfaces / APIs

### Organization APIs

- `GET /api/v1/org-nodes/tree?parent_id=&query=&limit=`：返回当前身份可见的直接子节点或搜索结果；每页最多 1,000 条。
- `POST /api/v1/org-nodes`：`{parent_id?, domain_id?, org_code, org_type, name, sort_order, idempotency_key}`；创建域根仅限系统级权限。
- `GET /api/v1/org-nodes/{id}`：返回节点、版本、祖先路径、直接成员数、下级成员数和授权摘要。
- `PATCH /api/v1/org-nodes/{id}`：`{version, org_code?, org_type?, name?, sort_order?}`；版本不符返回 409。
- `POST /api/v1/org-nodes/{id}/move`：`{version, new_parent_id, idempotency_key}`；拒绝环、跨域和越权移动。
- `POST /api/v1/org-nodes/{id}/disable|restore|archive`：状态转换；归档前返回结构化阻塞项。
- `GET /api/v1/org-types`、`POST/PATCH /api/v1/org-types`：系统级管理员维护展示类型字典。

### Principal APIs

- `GET /api/v1/principals?org_id=&include_descendants=&membership_type=&query=&cursor=`：服务端范围过滤和分页。
- `POST /api/v1/principals`、`PATCH /api/v1/principals/{id}`：通过 Keycloak 创建或修改用户身份资料，不接收或返回明文密码。
- `POST /api/v1/principals/{id}/enable|disable`：同步 Keycloak 状态并处理平台会话。
- `PUT /api/v1/principals/{id}/primary-org`：`{org_id, version, idempotency_key}`。
- `POST /api/v1/principals/{id}/collaborations`：`{org_id, idempotency_key}`。
- `DELETE /api/v1/principals/{id}/collaborations/{org_id}`：幂等移除协作关系。
- `GET /api/v1/principals/{id}/effective-permissions`：返回直接/组织来源、角色、权限点和资源范围；查看他人需专门权限。

### Role and assignment APIs

- `GET /api/v1/permissions`：返回系统权限点、风险等级和 `delegable`。
- `GET/POST/PATCH /api/v1/roles`、`POST /api/v1/roles/{id}/disable`：域内自定义角色管理，写入时做可委派权限子集检查。
- `GET/POST /api/v1/role-assignments`：授权请求包含 `subject_type`、`subject_id`、`subject_include_descendants`、`role_id`、`scope_org_id`、`scope_include_descendants`、有效期和幂等键。
- `DELETE /api/v1/role-assignments/{id}`：软撤销并保护最后一个全局系统管理员。
- `POST /api/v1/permissions/evaluate`：默认仅评估当前人员，输入资源上下文，输出是否允许及匹配来源；他人模拟需高风险权限且必须审计。

### Sync and error contract

- 所有写接口返回 `trace_id`、目标版本和同步状态 `SYNCED|PENDING`。
- Keycloak 成功而快照失败返回 HTTP 202 与 `sync_operation_id`，不得返回普通成功或伪造失败回滚。
- 乐观锁冲突返回 HTTP 409 `VERSION_CONFLICT`；范围或委派越权返回 403；环和跨域移动返回 422；归档受阻返回 409 并列出 `children|memberships|assignments`。
- 管理接口接受 `Idempotency-Key` 请求头；同一操作者、端点和键复用原逻辑结果。

## Data Model / Migrations

- `iam_org_type(code, name, icon, status, sort_order)`：可配置展示类型，不参与层级约束。
- `iam_org_node(id, keycloak_group_id, domain_id, parent_id, org_code, org_type, name, status, sort_order, version, synced_at)`：通用组织节点；域内编码唯一。
- `iam_org_closure(ancestor_id, descendant_id, depth)`：含节点自身 `depth=0`，用于成员和资源范围判断。
- `iam_principal`：保留 `issuer + subject` 唯一键，增加 `keycloak_user_id`、`primary_org_id`、`authorization_version`，迁移后移除固定部门/团队依赖。
- `iam_principal_org(principal_id, org_id, membership_type, status, valid_from, valid_to)`：数据库约束每人最多一个有效 `PRIMARY`，组织关系不重复。
- `permission_definition(code, resource_type, action, description, risk_level, delegable, status)`：仅由迁移和版本发布维护。
- `custom_role(id, domain_id, code, name, description, status, version, created_by, created_at, updated_at)`：域内代码唯一。
- `custom_role_permission(role_id, permission_code)`。
- `role_assignment(id, role_id, subject_type, subject_id, subject_include_descendants, scope_org_id, scope_include_descendants, status, valid_from, valid_until, created_by, created_at, revoked_by, revoked_at, version)`。
- `iam_sync_operation(id, operation_type, target_type, target_external_id, idempotency_key, payload_hash, status, attempts, next_retry_at, trace_id, last_error, created_at, completed_at)`。
- `idempotency_record(actor_id, route, key, request_hash, response_status, response_body, expires_at)`。
- 现有固定范围迁移：`GLOBAL` 到平台根兼容角色；`ALL_DEPARTMENTS` 到域根含下级；`DEPARTMENT_SET` 拆为每部门一条范围授权；`SELF` 到本人资源规则。
- 迁移先建立新表和双读验证，再回填、权限对比、切换读取；旧表在稳定期内保留只读，不在同一发布中物理删除。

## Security / Privacy

- Keycloak Admin API 使用独立 confidential client 和最小 `manage-users/query-users/view-users/manage-group-membership` 等必要权限；权限集合以真实 Keycloak 版本验证为准，不授予 `realm-admin`。
- 管理客户端 Secret、数据库密码和会话 Secret 通过部署 Secret 注入，不写入 Compose 明文或 Realm 导入文件。
- 平台不接收、存储或记录人员密码；密码初始化和重置使用 Keycloak action email 或受控管理流程。
- 所有写请求先鉴权再访问 Keycloak；Keycloak 成功后再次以不可变操作者身份完成快照和审计。
- 委派检查按每个权限点验证授权者有效范围，不能只检查角色名称。
- 组织树、人员列表、授权列表和审计列表均在服务端按有效范围过滤。
- 权限变更、人员停用和组织移动失效相关缓存；人员停用删除 BFF 会话。
- 审计仅保存字段级差异摘要，不保存 Token、Cookie、密码或完整敏感载荷。

## Observability

- 结构化日志字段：`trace_id`、`actor_id`、`operation`、`target_type`、`target_id`、`keycloak_status`、`snapshot_status`、`attempt`、`duration_ms`。
- 指标：Keycloak Admin API 调用量/错误率/P95、待同步操作数与最老年龄、对账差异数、权限缓存命中率、授权判断 P50/P95/P99、403 数量、版本冲突数。
- 告警：待同步最老年龄超过 15 分钟、Keycloak 管理调用连续失败、对账差异异常增长、权限判断 P95 超标、最后系统管理员保护触发。
- 审计事件覆盖组织、成员、人员状态、角色、授权、权限模拟、同步失败和对账修复。

## Test Strategy (map to acceptance scenarios)

- P1 组织 AS1 → Keycloak 集成测试创建 8 层 Group，验证快照字段、闭包和树 API。
- P1 组织 AS2 → API 测试重命名有成员/授权节点，验证 ID、Membership、授权效果和审计前后值。
- P1 组织 AS3 → 领域单元测试与 API 集成测试移动分支，验证环/跨域拒绝、闭包重建和继承权限切换。
- P1 组织 AS4 → 归档阻塞矩阵测试子节点、成员、授权三类冲突及清理后归档。
- P1 人员 AS1 → Keycloak Membership 集成测试和数据库唯一约束测试覆盖一个主组织、两个协作组织及重复提交。
- P1 人员 AS2 → 调动测试验证 `issuer + subject`、协作关系和权限来源保持正确。
- P1 人员 AS3 → 真实会话 API 测试停用人员、撤销 BFF 会话和后续 401/403。
- P1 权限 AS1 → 角色 API 测试权限目录引用、域隔离及 Keycloak Realm Role 未变化。
- P1 权限 AS2 → 授权对象/资源范围四组合矩阵测试 CBB 允许和 KOS 403。
- P1 权限 AS3 → 单元属性测试直接、主组织、协作组织并集以及有效期、撤销、停用。
- P1 权限 AS4 → 委派攻击矩阵测试权限子集、范围包含、不可委派和角色修改绕过。
- P2 同步 AS1 → 故障注入测试 Keycloak 成功/平台失败、202、幂等重试和最终一致。
- P2 同步 AS2 → 外部 Keycloak 修改后运行全量对账，验证分页、断点、修复和审计摘要。
- P2 迁移 AS1 → 迁移夹具和权限差分工具验证 V0.1 人员稳定身份及无权限扩大。
- P2 迁移 AS2 → 每种管理写操作的成功、拒绝和部分成功审计测试，并扫描敏感值。
- NFR-001 → 生成约定规模夹具执行授权评估基准，记录缓存命中/未命中 P95。
- E2E → 系统管理员创建组织和人员、创建角色、授权团队、目标用户登录并验证允许操作与跨组织 403。

## Rollout Plan (if user-facing)

1. 备份 Keycloak 和平台 PostgreSQL，部署只新增表的迁移与权限点种子。
2. 启用组织/人员快照双写与后台对账，但继续从 V0.1 授权读取；观察同步指标。
3. 回填通用组织、成员、兼容角色和授权，生成迁移前后权限差分报告；发现扩大即阻止发布。
4. 以服务端开关启用新授权读取的影子评估，记录新旧判定差异但仍执行旧结果。
5. 差异清零后切换服务端授权到新模型，再开放系统管理员组织/角色管理页面。
6. 分域开放委派管理员写入能力，监控 403、版本冲突、同步积压和审计完整性。
7. 稳定期后停止旧表写入并保留只读回滚窗口；旧表物理删除另立规格。

## Risks + Mitigations

- Keycloak 与平台无法单事务提交 → Keycloak 写入优先、幂等操作表、202 部分成功、重试和全量对账。
- 组织移动使大量继承授权改变 → 移动前影响预览、闭包事务更新、授权版本批量递增、缓存按版本失效。
- 自定义角色导致权限提升 → 权限点级委派子集检查、不可委派标记、范围包含校验和越权审计。
- 多组织成员关系让权限难以解释 → 有效权限 API 返回每项权限的角色、授权对象、资源范围和继承来源。
- V0.1 迁移意外扩大权限 → 新旧引擎影子评估和允许集合差分，任何扩大阻止切换。

## Assumptions (if needed)

- Keycloak 26.7 的具体细粒度 Admin API 服务账号权限名称将在实现时通过集成测试固定；原则是不授予 `realm-admin`。
- 定时对账由现有平台进程中的受控后台任务执行；本阶段不为此引入 Redis、Celery或新服务。
- 管理页面首先服务桌面浏览器，组织树采用懒加载而非一次渲染全部 10,000 个节点。
