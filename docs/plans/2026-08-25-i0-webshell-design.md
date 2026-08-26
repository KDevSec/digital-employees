# I0-5 Web 壳补全设计（注册约定化 + F-02/F-03/F-04 + engine 空壳）

> 日期：2026-08-25
> 状态：🟢 已定稿（规格已在功能点清单行级定义，本文只写结构决策与迁移映射，不重复 F 系列规格）
> 分支：`i0-webshell`（worktree `.worktrees/i0-webshell`，端口纪律 19982，不合流 main）
> 输入：[需求路线图](2026-08-25-requirements-roadmap.md) §4.2/§4.3/§5 I0-5 · [功能点清单](../design/概要设计/套件工作台V0.1功能点清单-2026-08-23.md) §5.5 F-02/F-03/F-04 · [登录与认证设计 v0.2](../design/详细设计/登录与认证设计-v0.2.md)（🟢 基线）· [服务本体详设](../design/详细设计/工作台服务本体详细设计-v0.1.md) §1.1/§1.2/§10.2 · workbench-demo/src（迁移参照）· workbench-{service,web} 现状
> 产出物：本设计 → 实施计划（2026-08-25-i0-webshell.md）→ TDD 实现（subagent）→ 验证

---

## 1 增量定位

**消灭 I1 三线并行的最大合并冲突面（路线图 §4.2），并补上 M1 前端欠账 F-02/F-03/F-04。** 五件事：① service 路由注册分域约定化（对齐详设 §1.2 既有设计，非新发明）；② web router 同构约定化；③ F-03 登录与接入页 Vue 化（ui.ts 迁移）；④ F-02 导航骨架 + 登录态路由守卫；⑤ F-04 顶栏全局态。另建 workbench-engine 空壳（@devzero/engine，只骨架不逻辑）。

**不碰**：认证服务端（A 系列 = `app/platform-access`，M1 未开工，详设 §10.2 已定其宿主位）；员工业务 E/B 系列；bun.lock 除 engine 空壳与 web 测试环境新增 devDeps 外不动。

## 2 结构决策

| # | 决策 | 依据 |
|---|------|------|
| D-1 | service 分域注册 = **详设 §1.2 RouteModule 模式的落地**：`src/server/routes/<domain>.ts` 每域一文件，域文件导出注册函数；`routes/index.ts` 静态汇总表（一行一域）；`main.ts` 改调汇总注册 | 详设已定「每模块一个目录 + main.ts 收集」；现状 endpoints.ts 单文件是框架增量期的骨架简化（D-6 出栈注记），本线对齐设计 |
| D-2 | 汇总用**静态 import 列表**，不做 fs 扫描/动态 import 自动发现 | bun `--compile` 单体里文件系统布局不存在，动态加载不可靠；静态列表的冲突面 =「不同位置各插一行」，git 可自动合并——从「同文件多函数混编」降一档即可满足 I1 并行需求 |
| D-3 | 现有 4 端点分两域起步：`routes/infra.ts`（/healthz、/api/activity、/api/events——服务本体自观察）+ `routes/shell.ts`（/ 嵌入页）。I1 各线新增域 = 各自新文件 + index 加一行 | 端点归属按详设 §10.2 模块列前瞻划分；auth/employees/bases/kanban 域文件由对应线自建，本线不预建空文件 |
| D-4 | web 同构约定：`src/router/routes/<domain>.ts` 每域导出 `RouteRecordRaw[]`，`router/index.ts` 汇总 + 全局守卫。域与 service 侧一一对应（access/employees/bases/kanban） | 「router 同构约定」任务原文；同一业务域前后端路由各归一文件，合流冲突面同构收敛 |
| D-5 | 布局：`/`（接入页）独立全屏无侧栏；登录态业务页走 `Layout.vue`（侧栏 + 顶栏 + router-view）嵌套路由 | v0.2 §3「登录与接入页（唯一未登录可达页）」；未登录不露导航（D-031 精神：不给死入口） |
| D-6 | 路由表：`/` 接入页（常驻可达，登录后显示状态卡——demo 同语义）；`/employees` 我的员工占位（侧栏默认选中）；`/bases` 底座与环境占位；`/kanban` 任务看板占位（D-036 拉前解隐，L5 前为占位页）；「我的群组与对话」置灰无路由（Q-010）；workflow 编排入口不渲染 | F-02 行 + 用户 I0-5 口径（任务看板入口解隐为占位路由） |
| D-7 | 守卫：Pinia session store 启动拉一次 `/api/state`；未认证访问非 `/` → 重定向 `/`。fetch 失败按未认证处理（接入页自有 healthz 红徽章提示服务不可达）。已登录访问 `/` 不跳转（接入页登录后就是状态卡，demo 同语义，不发明跳转） | D-031 只定义未登录边界；「我的员工（默认）」= 侧栏默认选中项，登录后落地页是否自动跳转留业务填充时定 |
| D-8 | F-03 纯前端消费契约 = v0.2 §5.2 端点表 + demo 实证形态；**service 侧 auth 端点缺口落 §4 记录待裁决，本线不补** | 任务原文「服务侧接口缺口或语义疑问落文档记录待用户裁决，不自行发明」 |
| D-9 | dev 冒烟代理：vite proxy 目标改 env 可配 `VITE_PROXY_TARGET ?? 19980`（默认值不变），本线冒烟 `VITE_PROXY_TARGET=http://127.0.0.1:19982`；代理键增 `/auth` | 端口纪律 19982（路线图 §4.3）；合流后默认行为与 main 一致 |
| D-10 | web 测试环境：加 devDeps `@vue/test-utils` + `jsdom`，vitest 增 `environment` 配置；纯函数测试形态沿用 api/health.ts 先例 | 组件/路由守卫需挂载测试；既有 11 测试不受影响（纯逻辑 include 不变，新增 .test.ts 文件夹分流） |
| D-11 | Home.vue 退役，healthz 消费逻辑（fetch/interpret/versionLine）迁入顶栏（F-04 本就要版本行）；纯函数与 11 个测试原样保留 | Home 是 D-6「占位页」，F-02/F-04 落地后无存在意义；测试测纯函数不测组件，安全 |
| D-12 | engine 空壳 = `workbench/workbench-engine`（@devzero/engine）：package.json/tsconfig/vitest/空入口 src/index.ts + smoke 测试（import 不炸）+ README 一句话 | 路线图 §4.2「engine 包空壳 I0 建好之后各线少动」；workspace glob workbench/* 自动纳入 |

## 3 F-03 迁移映射（ui.ts → Vue）

| ui.ts 元素 | Vue 归宿 | 备注 |
|------------|---------|------|
| `statusLabel` 状态中文映射 + badge class 表 | `api/access.ts` 纯函数 `statusLabel()` / `statusBadgeClass()` | 单测直接搬 demo 全状态集 |
| `#state` 行（企业用户/Installation ID/申请 ID/工作台 ID/状态徽章/最后心跳） | `components/access/AccessStatusCard.vue` | 数据源 `GET /api/state` |
| 拒绝原因 / 申请异常 notice | AccessStatusCard 内条件块 | REJECTED/ERROR 态 |
| 「请先登录」/「能力已锁定」提示 | AccessStatusCard 内条件块 | 未登录 / 登录未 ACTIVE |
| 动作按钮组（登录/重新提交/心跳/重置/登出 + 显隐条件） | `components/access/AccessActions.vue` | 显隐条件照搬 demo 布尔式（语义不动） |
| 登录按钮 `location.href='/auth/login'` | 同语义（整页跳转，非 SPA 内导航） | OIDC 是出站 302，必须整页跳 |
| 5s 轮询（authenticated 且 PENDING_REVIEW/APPROVED → POST /api/progress + 刷新） | AccessView 组合式轮询（onUnmounted 清理） | 节奏属 UI 行为，沿用 demo 5s |
| `esc()` 手工转义 | 模板插值自动转义，天然消解 | — |
| 安全边界静态卡 | AccessView 静态 section 原样迁移 | — |
| 「返回管理平台」链接 | 迁移（href 来自 state 数据外的常量；dev 语境 demo 用 env，Vue 侧从 `/api/state` 同源拿不到时显示省略） | 见 §4 G-5 |

**`/api/state` 消费形状**（demo server.ts 实证）：`{ installationId, enrollmentId?, workbenchId?, status, lastHeartbeatAt?, rejectionReason?, error?, authenticated, user? }`（privateJwk/publicJwk 剥离）。字段全可选容错（外部对象不可信，沿 api/health.ts 先例）。

**F-04 顶栏数据源**：用户（user.name / preferred_username / email——头像无 picture claim，用名首字母圆徽 + 邮箱，形态自由度内）；平台连接状态 = 纯函数 `interpretPlatformStatus(stateJson, stateFetchOk)`（心跳 OK / 未激活中性 / REVOKED 告警 / 服务不可达告警条——D-032 提示而非降级）；版本 = 既有 versionLineGated；检查更新 = 占位按钮（点击提示「即将上线」，U 系列未落地）。

## 4 服务侧接口缺口与语义疑问（落档待用户裁决）

| # | 事项 | 现状证据 | 建议 |
|---|------|---------|------|
| G-1 | service 无任何 auth 端点（/auth/login、/api/state 等），F-03 前端契约暂无本地生产方 | service 仅 4 端点；详设 §10.2 已把 auth 端点规划给 `app/platform-access`（A 系列 M1 未开工） | A 系列线落位；本线 dev 冒烟经 vite proxy 走 workbench-demo（既有实现，19982 起 demo server） |
| G-2 | `/api/progress` 方法：v0.2 §5.2 标 **GET**，demo 实现是 **POST** | v0.2 端点表 vs demo server.ts L183 | A 系列迁移时定稿；前端调用集中在 api/access.ts 一处，届时一行改 |
| G-3 | `/api/enroll`、`/api/reset` 未入 v0.2 §5.2 端点表，demo 在用（手动重提/重置） | v0.2 §5.5「REJECTED 可手动重新申请」有语义支撑但端点表缺行 | A 系列迁移时补端点表或去按钮；前端先按 demo 保留 |
| G-4 | 登录后落地页语义：v0.2 未定义登录成功回调后是否跳业务页 | demo callback redirect '/'（落接入页） | 保持 demo 语义（不发明）；业务填充时再议 |
| G-5 | 「返回管理平台」链接的 platformPublicUrl 在 Vue 侧无来源（demo 是服务端 env 注入） | ui.ts 模板参数 | 前端暂不渲染该链接（或后续由 /api/state 增字段，A 系列定）；不阻塞验收 |

**本线对 G-1 的处置边界**：不迁 Express 逻辑、不在 service 造 mock auth 端点（=「不自行发明」）；组件测试用注入的 state fixture；dev 冒烟走 demo server（其 OIDC 全链依赖平台环境，平台不可达时冒烟覆盖到「未登录态 + 登录跳转发起」，全链程度记入验收记录）。

## 5 测试策略

- **service**：既有 101 测试不改语义保持绿（server.test.ts 若直接 import endpoints.ts 导出符号，随拆分改 import 路径，断言不动）；新增 routes/index 汇总测试——注册路由与期望路由表一致 + method/path 唯一性防重复注册（I1 并行的保险丝）。
- **web**：纯函数 TDD（statusLabel/statusBadgeClass/interpretPlatformStatus/守卫判定 `resolveRedirect(authenticated, toPath)`）；组件挂载测试（AccessView 未登录态渲染登录按钮、状态卡各状态渲染、AccessActions 显隐矩阵、侧栏置灰项与可点项、顶栏告警条条件）；守卫集成测试（未认证 → 重定向 /，已认证放行）。
- **冒烟**（端口 19982）：service `--foreground` 起 19982 验既有 healthz/嵌入页链路；demo server `WORKBENCH_PORT=19982 WORKBENCH_PUBLIC_URL=http://localhost:5173` 起 19982 验 F-03 全链（登录跳转发起 → 回调 → 状态卡，视平台环境可达程度）。

## 6 验收锚

1. 既有测试全绿（service 101 + web 11 基线不破）+ 新增测试绿；
2. service 分域注册后 `/healthz` `/api/activity` `/api/events` `/` 行为逐字节等价（契约测试佐证）；
3. 未登录访问 /employees /bases /kanban 均重定向 `/`；登录后可达 + 占位页可挂；
4. F-03 接入页 dev 模式（代理 demo）未登录态可用、登录跳转发起可达；
5. engine 空壳入 workspace，`bun test` 可发现其 smoke 测试；
6. web-dist 不提交（feature 分支纪律）。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-25 | 初版：12 项结构决策 + F-03 迁移映射 + 5 项缺口/疑问落档（G-1~G-5 待用户裁决） |
| 2026-08-26 | **视觉权威源变更（用户裁决）**：T2~T4 交付时必读材料未含 `docs/prototype/workbench.html`，视觉按 demo 绿色系简朴版交付；用户裁决「完全按照原型风格来修订」——原型（蓝色系：blue-950~50 谱 + g 系中性 + tag/btn/card/avatar 组件体系 + 78px 窄图标侧栏）为唯一视觉权威源，T7 全量修订（纯视觉层，功能/语义/测试断言不动）。原型未覆盖的 F-03 接入页与 F-04 顶栏按原型 token 延展。 |
