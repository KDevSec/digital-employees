# Tasks: 可配置组织树与分级权限管理

**Spec**: `/specs/002-organization-permission-management/spec.md`
**Decisions**: `/specs/002-organization-permission-management/decisions.md`
**Plan**: `/specs/002-organization-permission-management/plan.md`

## Instructions

- 按 P1、P2 用户故事顺序实施，使用 RED → GREEN → REFACTOR。
- 每项任务控制在约 30–90 分钟；超过范围时先拆分任务再编码。
- 每个验收场景至少包含一项实现任务和一项独立验证任务。
- 不删除 V0.1 表或数据卷；迁移采用新增、回填、影子验证和可回滚切换。

## P1 — 管理任意深度组织树

### Acceptance Scenario 1 — 创建任意深度组织并同步 Keycloak
- [ ] [Impl] 在 `platform/backend/app/models.py` 和新 Alembic 迁移中增加 `iam_org_type`、`iam_org_node`、`iam_org_closure`、`iam_sync_operation`、幂等记录及必要索引约束。
- [ ] [Impl] 在 `platform/backend/app/iam/` 建立 Keycloak Admin gateway，支持细粒度凭据、分页 Group 读取、嵌套 Group 创建和按幂等键确认创建结果。
- [ ] [Impl] 实现组织节点创建领域服务，按 Keycloak 写入→对象回读→快照/闭包事务→缓存失效→审计的顺序执行。
- [ ] [Impl] 在 `platform/backend/app/api/` 增加组织类型与组织树懒加载/搜索/创建接口，并按调用者范围过滤结果。
- [ ] [Verify] 先写 Keycloak 集成测试创建至少 8 层 Group，再验证稳定 ID、父子关系、类型、编码、名称、状态、排序、闭包和树 API 一致。
- [ ] [Verify] 增加组织 API 未授权、跨域不可见、重复幂等键和单页上限 1,000 条测试。

### Acceptance Scenario 2 — 重命名不破坏成员和授权
- [ ] [Impl] 实现带版本号的组织节点 PATCH，同步 Keycloak 名称/属性并保留 `org_id` 和 Group ID。
- [ ] [Impl] 扩展审计事件字段级差异摘要，记录重命名前后名称且过滤敏感数据。
- [ ] [Verify] 先写重命名有成员和有效授权节点的 API 测试，断言 ID、Membership、授权判定不变且审计差异正确。
- [ ] [Verify] 增加旧版本更新返回 409 且不覆盖新名称的并发测试。

### Acceptance Scenario 3 — 同域移动并切换继承范围
- [ ] [Impl] 实现组织闭包的建树、插入和移动算法，拒绝自身、后代、归档父节点及跨域目标。
- [ ] [Impl] 实现移动影响预览、Keycloak Group 移动、闭包事务重建及受影响人员授权版本递增。
- [ ] [Verify] 先写闭包领域测试覆盖深树移动、整分支移动、环检测和跨域拒绝。
- [ ] [Verify] 增加 API/授权集成测试，断言移动后旧祖先授权失效、新祖先授权生效且缓存版本更新。

### Acceptance Scenario 4 — 安全归档组织
- [ ] [Impl] 实现组织停用、恢复和归档状态机，并查询子节点、有效成员、有效授权三类阻塞项。
- [ ] [Impl] 在创建子节点、添加成员和创建授权入口统一拒绝归档组织。
- [ ] [Verify] 先写三类归档阻塞和清理后成功归档测试，断言 409 结构化阻塞响应及审计事件。
- [ ] [Verify] 增加归档节点拒绝新增子节点、成员和授权的跨 API 回归测试。

## P1 — 管理人员主组织与协作组织

### Acceptance Scenario 1 — 一个主组织和多个协作组织
- [ ] [Impl] 增加 `iam_principal_org`、人员 `primary_org_id/keycloak_user_id/authorization_version` 字段及有效主组织唯一约束。
- [ ] [Impl] 扩展 Keycloak gateway 的 User、Membership 和用户属性读写，并实现人员与成员关系同步服务。
- [ ] [Impl] 增加设置主组织、添加/移除协作组织 API，拒绝重复关系、主协作重叠和归档节点。
- [ ] [Verify] 先写数据库约束和 API 测试，覆盖一个主组织、两个协作组织、重复幂等提交及第二主组织冲突。
- [ ] [Verify] 增加 Keycloak Membership、`primary_org_id` 与平台快照双向一致的真实集成测试。

### Acceptance Scenario 2 — 调动主组织并保持稳定身份
- [ ] [Impl] 实现主组织调动事务流程，保留 `issuer + subject` 和全部协作组织，结束旧主关系并建立新主关系。
- [ ] [Impl] 在调动后递增授权版本、失效权限缓存并记录组织变更审计。
- [ ] [Verify] 先写人员调动测试，断言稳定身份、协作关系、旧/新组织授权来源和审计均正确。
- [ ] [Verify] 增加并发调动版本冲突及 Keycloak 写入超时后幂等恢复测试。

### Acceptance Scenario 3 — 停用人员并使会话失效
- [ ] [Impl] 实现人员启用/停用 API，同步 Keycloak 状态并使平台授权缓存和 `BffSession` 失效。
- [ ] [Impl] 在身份依赖中增加人员当前状态校验，防止残留会话绕过停用。
- [ ] [Verify] 先写真实 BFF 会话测试，停用后在 60 秒要求内返回 401/403 且无有效业务权限。
- [ ] [Verify] 增加最后全局系统管理员被停用时的保护和审计测试。

## P1 — 配置自定义角色和组织范围授权

### Acceptance Scenario 1 — 从系统权限点创建自定义角色
- [ ] [Impl] 增加 `permission_definition`、`custom_role`、`custom_role_permission` 及种子迁移，将现有权限映射为版本化权限点。
- [ ] [Impl] 实现权限目录和域内角色查询、创建、复制、修改、停用 API，使用乐观锁和软状态。
- [ ] [Impl] 在角色写入时校验权限点存在、有效、域隔离、风险等级和授权者可委派子集。
- [ ] [Verify] 先写角色 API 测试创建“CBB团队管理员”，断言权限引用正确且 Keycloak Realm Role 未改变。
- [ ] [Verify] 增加跨域角色读取/修改拒绝、停用角色和旧版本 409 测试。

### Acceptance Scenario 2 — 组织成员授权与资源范围授权
- [ ] [Impl] 将角色授权模型升级为人员/组织两类 `subject`、独立成员下级开关、组织资源范围和资源下级开关。
- [ ] [Impl] 实现基于闭包表的授权对象匹配和 `ResourceContext` 资源范围匹配，保留本人所有者检查。
- [ ] [Impl] 增加通用角色授权 CRUD、幂等创建、软撤销和结构化授权预览 API。
- [ ] [Verify] 先写四种下级开关组合的领域测试，覆盖 CBB/安全研发组允许和 KOS 403。
- [ ] [Verify] 增加直接成员、下级成员、非成员、跨域资源和本人资源 API 授权矩阵测试。

### Acceptance Scenario 3 — 合并多来源权限并处理生命周期
- [ ] [Impl] 实现直接人员、主组织、协作组织和祖先组织授权查询及允许权限并集。
- [ ] [Impl] 实现角色状态、授权状态、生效/失效时间和人员状态过滤，以及 `principal_id + authorization_version` 缓存键。
- [ ] [Impl] 增加有效权限解释 API，返回每项权限的角色、直接/组织来源和资源范围。
- [ ] [Verify] 先写属性/参数化测试覆盖多来源并集、重叠范围、到期、撤销、角色停用和人员停用。
- [ ] [Verify] 增加权限变更后缓存版本失效及有效权限解释响应测试。

### Acceptance Scenario 4 — 防止委派权限提升
- [ ] [Impl] 实现权限点级委派校验器，验证 `role.assign`、对象管辖、权限子集、`delegable` 和范围包含关系。
- [ ] [Impl] 在角色创建/修改、授权创建/修改、人员/组织管理入口复用委派校验器，避免旁路。
- [ ] [Impl] 实现最后全局系统管理员和系统级不可委派权限保护。
- [ ] [Verify] 先写委派攻击矩阵，覆盖无权限、不可委派、超范围、跨域、修改角色绕过和自授权提升。
- [ ] [Verify] 增加每类拒绝的 403、无状态变更和越权审计断言。

### Existing business API migration
- [ ] [Impl] 为工作台、登记审批、安装包、审计和设置资源定义统一 `ResourceContext` 适配器。
- [ ] [Impl] 逐个把 `platform/backend/app/api/` 现有权限入口迁移到新授权检查器，保留兼容开关用于影子评估。
- [ ] [Verify] 对现有 API 测试增加新旧授权双判定，断言切换前无既有允许场景回归且跨组织请求仍为 403。

## P2 — 保持 Keycloak 与平台快照最终一致

### Acceptance Scenario 1 — Keycloak 成功后平台同步失败
- [ ] [Impl] 实现 `iam_sync_operation` 状态机、负载哈希、尝试次数、指数退避、下一重试时间和完成状态。
- [ ] [Impl] 在管理写流程中捕获 Keycloak 成功/快照失败边界，返回 202、`sync_operation_id`、`trace_id` 和 `PENDING`。
- [ ] [Impl] 增加平台进程内受控重试执行器及积压年龄指标，不引入新消息服务。
- [ ] [Verify] 先写故障注入测试，在快照事务点失败，断言 Keycloak 仅写一次、API 返回 202、重试幂等补齐快照。
- [ ] [Verify] 增加超过 15 分钟积压告警、最大退避和错误信息脱敏测试。

### Acceptance Scenario 2 — 全量对账修复外部修改
- [ ] [Impl] 实现分页、断点和幂等的 Group/User/Membership 全量对账服务，以 Keycloak 为事实更新平台状态。
- [ ] [Impl] 增加受系统权限保护的对账触发/状态 API、周期调度和差异摘要审计。
- [ ] [Verify] 先在 Keycloak 外部创建、移动、重命名 Group 和调整 Membership，运行对账并断言平台完全修复。
- [ ] [Verify] 增加 100,000 人夹具的分页/断点测试和在线授权请求不被长事务阻塞的验证。

## P2 — 迁移并审计 V0.1 数据

### Acceptance Scenario 1 — 迁移固定组织和角色范围
- [ ] [Impl] 编写 Alembic 回填，把域、部门、团队转换为通用节点并建立闭包，保留现有稳定 ID。
- [ ] [Impl] 把人员固定组织列转换为主组织关系，并将 `GLOBAL/ALL_DEPARTMENTS/DEPARTMENT_SET/SELF` 转换为兼容角色与通用范围授权。
- [ ] [Impl] 建立新旧授权影子评估和允许集合差分命令，发现迁移后权限扩大时使发布检查失败。
- [ ] [Verify] 使用包含多部门范围和六种固定角色的 V0.1 夹具执行迁移，断言 `issuer + subject` 不变且权限不扩大。
- [ ] [Verify] 验证迁移可重复运行、失败可回滚，旧表保持只读且不在本发布物理删除。

### Acceptance Scenario 2 — 全面审计管理变更
- [ ] [Impl] 为组织、人员、成员、角色、授权、权限模拟、同步失败和对账修复定义审计事件类型及字段级摘要。
- [ ] [Impl] 在所有管理写入口统一传递不可变操作者、组织范围和 `trace_id`，失败路径同样写审计。
- [ ] [Verify] 为每类写操作增加成功、拒绝或部分成功审计测试，断言操作者、目标、范围、摘要、结果和追踪 ID。
- [ ] [Verify] 扫描测试日志和审计载荷，断言无密码、Keycloak Token、Cookie、Secret 或完整敏感请求体。

## P2 — 管理平台交互界面

### Organization and principal management UI
- [ ] [Impl] 在 `platform/frontend/src/features/` 实现懒加载组织树、节点详情、创建/编辑/移动/状态操作和影响预览。
- [ ] [Impl] 实现人员搜索、主组织、协作组织、启停状态和直接/下级成员视图，并处理 202 同步中与 409 版本冲突。
- [ ] [Verify] 增加前端组件测试覆盖深树懒加载、移动环错误、归档阻塞、主/协作组织和范围过滤。
- [ ] [Verify] 增加 Playwright 流程：管理员创建组织、创建/选择人员、设置主组织和协作组织、重命名与移动节点。

### Role and assignment UI
- [ ] [Impl] 重构 `PermissionsPage.vue` 为权限点目录、自定义角色编辑、授权对象、双下级开关、资源范围和有效期向导。
- [ ] [Impl] 实现有效权限解释和授权影响预览，明确显示直接、主组织、协作组织和祖先来源。
- [ ] [Verify] 增加组件测试覆盖不可委派权限禁用、超范围提示、角色停用和权限来源展示。
- [ ] [Verify] 增加 Playwright 流程：创建 CBB 团队角色、授权团队、目标用户登录验证允许操作及 KOS 跨组织 403。

## Non-functional and operational verification

- [ ] [Verify] 生成 10,000 个组织、100,000 个人员、每人 20 条有效授权的基准夹具，验证缓存命中 P95 ≤ 50 ms、未命中 P95 ≤ 250 ms。
- [ ] [Impl] 为 Keycloak 调用、同步积压、对账差异、权限缓存、权限判断、403 和版本冲突增加结构化日志、指标和告警阈值。
- [ ] [Verify] 验证所有组织/人员列表均在服务端范围过滤，任何单页不超过 1,000 条，前端没有接收越权全量数据。
- [ ] [Verify] 验证 Keycloak 管理客户端不是 `realm-admin`，所有运行凭据来自部署 Secret，仓库和前端构建物无明文 Secret。

## Final Verification

- [ ] Verify all acceptance scenarios：逐项执行 spec.md 的 P1/P2 验收场景、迁移差分、故障注入、性能基准、后端完整测试、前端测试和真实 Keycloak E2E，并记录命令、通过数、失败数及未覆盖风险。
