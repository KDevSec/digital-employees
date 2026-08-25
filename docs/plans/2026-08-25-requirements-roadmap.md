# 需求路线图：M2 员工闭环 + 内置 team 协同编排（并行交付）

| 项 | 值 |
|----|-----|
| 版本 | v0.1 |
| 日期 | 2026-08-25 |
| 状态 | 🟢 裁决定稿（四项用户裁决落档 D-036~D-038）；各线 design/plan 文档另行产出 |
| 性质 | **路线图**——多线并行交付的组织文档，**不是**单特性实施计划。各线开工前按惯例产出 `docs/plans/<日期>-<线名>-design.md` + `-plan` 文档对；本文件不带 executing-plans 执行头，防止被误当逐任务计划执行 |
| 裁决来源 | 用户裁决 2026-08-25（§2）；1.0 参照 = agents-team `feat/demo-4stage-flow` 分支 |
| 依据 | [功能点清单 V0.1 基线](../design/概要设计/套件工作台V0.1功能点清单-2026-08-23.md)、[白皮书 v0.8](../design/概要设计/数字员工套件2.0架构白皮书-v0.8.md) §4.2/§10、[员工运行与展示设计 v0.1](../design/概要设计/员工运行与展示设计-v0.1.md)、D-017/D-030/D-034 |

---

## 0. 摘要

**现状**：M0 ✅（Spike 报告）；服务骨架/守护/托盘壳/真安装包已交付（[框架增量](2026-08-24-workbench-framework.md) + [真安装包](2026-08-25-真安装包.md) 执行记录全绿）；**M1 前端欠账（F-02~F-04）与 M2 员工业务域均未开工**；编排与看板原属 L2 范围（本路线图拉前，D-036）。

**组织**：两波次五线。第一批三线 worktree 并行（员工新建 / 员工安装 / 编排引擎），第二批两线（员工运行 / 任务看板）在契约稳定后加入。**并行的支点 = I0 冻结契约四件套**——并行开发最大的风险不是代码冲突，是各自发明契约。

**交付物**：M2 员工闭环全链（创建→拉 skill→安装→使用→卸载）+ **内置 team 协同编排演示**——四阶段流程引擎真实推进（非手写账本）、任务看板实时可视化，demo-4stage-flow 等价场景跑在自家栈上。

| 迭代 | 时长估 | 交付物 | 形态 |
|------|--------|--------|------|
| I0 地基与契约 | ~2-3 天 | 裁决落档 / 编排设计文档 / 契约四件套 / Web 壳补全 + 注册约定化 / worktree 地基 | main 单线 |
| I1 三线并行 | ~1 周 | L1 员工新建 / L2 员工安装 / L3 编排引擎纯库 | 3 worktrees |
| I2 两线加入 + 编排闭环 | ~1 周 | L4 员工运行 / L5 任务看板 / 引擎接入（HTTP+MCP）/ 内置 team demo / M2 验收 | 5 线汇流 |
| I3 收口与演示打磨 | ~1 周 | e2e + 演示脚本 + 文档回写 + 模式二裁决点 | main 单线 |

---

## 1. 背景与目标

### 1.1 现状

- 服务侧：workbench-service（hono + zod，101 测试）、托盘壳（Go）、真安装包（Inno Setup）已交付；前端仅 Web 壳骨架（单路由 + 89 行 Home.vue）。
- 文档侧：M2 三份详细设计（shared-protocol / 员工业务 / 安装适配）🟡 草案待评审；编排与看板无设计文档（I0 补）。
- 1.0 参照：agents-team `feat/demo-4stage-flow`——引擎被动账本（`ieidev_core`）+ node-table 配置直驱 + HUD 看板渲染，四阶段流程引擎真实推进的实证。

### 1.2 目标

1. **业务**：M2 员工闭环全链达功能点清单 M2 验收口径。
2. **演示**：内置 team 协同编排——四阶段 + 安全闸 + reflow 语义，看板实时推进。
3. **效率**：三线并行压缩交付周期（worktree 隔离 + 契约冻结纪律）。

### 1.3 非目标（本次裁决不做）

- workflow 编辑器、审批工作台——仍留 L2（D-036）。
- 模式二自动派发（spawn 底座 CLI）——待模式一跑通后裁决（D-037）。
- 群组、goal 编排、触发器子系统——归属不变（0.2+/L3）。

---

## 2. 范围裁决（用户裁决 2026-08-25）

| # | 裁决 | 记录 |
|---|------|------|
| 1 | 「编排引擎 TS 重写 + 任务看板 + **内置 team 协同编排执行**（类似 agents-team 形态，方便演示）」拉前进当前版本；**workflow 编辑器、审批工作台不做，仍留 L2** | D-036 |
| 2 | 运行模式先**模式一**（引擎账本 + 员工经 MCP 回报 + SSE 看板，主控驱动）；模式二后议 | D-037 |
| 3 | `.ieidev` 工程记忆仓在 worktree 内**暂不处理**（不建 junction、不配 sync off；worktree 无记忆目录导致 hook 警告属已知行为） | D-038 |
| 4 | 并行度 = **首批三线**（避免混乱）；第二批两线契约稳定后加入 | D-038 |

**治理链**：本节裁决 → 决策记录 D-036~D-038（已随本路线图落档）；功能点清单冻结基线的回写（§9 L2 行拆分 + M2/M3 里程碑验收扩展 + F-02 任务看板入口解隐）统一在 **I3** 做——编排设计定稿后一次对齐，避免中途反复改冻结文档。

---

## 3. 内置 team 协同编排（方向基线）

> 本节是分工与依赖的锚点；实现级设计（内置 team 形态 / 主控驱动方式 / MCP 工具面 / schema 细节）由 **I0 编排设计文档**定稿。

### 3.1 三层分离（1.0 实证直接继承）

| 层 | 1.0（agents-team `feat/demo-4stage-flow` 实证） | 2.0 归宿 |
|----|------|------|
| 引擎（被动账本） | `ieidev_core`：flow_state + events JSONL + node_machine 推进 + gate 判定 | **TS 纯库**（R1 状态机 / R2 节点图+guard / R3 gate，D-017），随 workbench 交付 |
| 驱动（大脑） | L0 主控会话跑 flow-driver skill（读表 → 派发 → 记账） | 主控员工驱动（具体形态 I0 定稿） |
| 可视化 | HUD 独立 HTTP 服务读 `.ieidev` events | workbench SSE → 任务看板 |

继承要点：**拓扑 = 叙事**——引擎不感知具体员工，流程是数据（node-table YAML 直驱；demo-flow 零引擎改动先例）；**引擎真实推进，非手写账本**（demo 稳定性红线）。

### 3.2 模式一运行形态

```
┌─ workbench-service ──────────────────────────────────┐
│  engine（TS 纯库）：flow_state + events 账本 + gate    │
│    ├─ HTTP API + SSE ──→ 任务看板（events 实时推送）    │
│    └─ MCP server ──→ 员工会话（advance / record-gate…）│
└───────────────────────────────────────────────────────┘
          ▲ MCP（员工包 mcp.json 挂引擎工具 = UPP 四层适配第一层）
┌─ 底座会话（CodeBuddy / Qoder CLI）─────────────────────┐
│  主控员工：读 node-table → 派发 → 推进 / 记闸           │
│  内置 team 成员（req-architect / dev-engineer）：干活    │
└───────────────────────────────────────────────────────┘
```

- **内置 team** = 预置员工包（复用 E-11 创建向导的预置模板 dev-engineer + req-architect，吃自己狗粮）+ 主控员工 + 预置 node-table（四阶段 demo-flow 等价物）。
- 验收场景 = demo-4stage-flow 等价：需求核验 → 设计核验 → 开发实现 → 安全评审（gate + reflow）→ 交付清点。
- 模式一**不依赖** D-030 移出 V0.2 的会话路由（不 spawn、不流式回显）——全部通道就是 MCP 回报 + SSE 推送。

### 3.3 契约四件套（I0 冻结，并行的支点）

| 契约 | 生产方（I0） | 消费方 |
|------|-------------|--------|
| E-01~03 manifest/skill schema（shared-protocol 真源） | 既有详细设计评审转 🟢 | L1 / L2 / L4 |
| node-table schema（TS 化，从 demo.node-table.yml 提炼） | 编排设计文档 | L3 / L5 / 内置 team |
| events 账本 schema（run / dispatch / advance / gate / handoff…） | 编排设计文档 | L3 / L5 |
| SSE 通道契约（events → 看板数据流） | 编排设计文档 | L4 / L5 |

**纪律：契约只在 main 上变更**（变更走设计修订记录）；worktree 内只消费不修改。L5 看板对 events fixture 先行开发，不依赖引擎跑通。

---

## 4. 并行开发方案（worktree）

### 4.1 波次表

| 波次 | 线 | worktree | 范围（功能点） | 开工依赖 |
|------|----|---------|--------------|---------|
| 第一批（I1） | L1 员工新建 | `.worktrees/l1-create` | E-01~03 真源 + E-11 向导 + E-12 包构建 + E-13 AgentHub 拉取 | E-01~03 契约 |
| | L2 员工安装 | `.worktrees/l2-install` | B-01~B-07（B-06 底座探测页随线交付） | manifest 契约；D-034 落位实证 |
| | L3 编排引擎 | `.worktrees/l3-engine` | R1/R2/R3 + events 账本 + node-table 加载 + MCP server spike | node-table/events 契约 |
| 第二批（I2） | L4 员工运行 | `.worktrees/l4-runtime` | E-10 列表 + E-14 详情 + E-15 展示侧 + SSE 通道（service 侧实现） | L1/L2 合流（manifest 真源可用） |
| | L5 任务看板 | `.worktrees/l5-kanban` | SSE 消费 + 看板 UI（F-02 看板入口解隐） | events/SSE 契约（fixture 先行，不等引擎） |

### 4.2 冲突面与处置

| 冲突点 | 处置 |
|--------|------|
| [registry.ts](../../workbench/workbench-service/src/server/registry.ts) / endpoints.ts / web router 注册点 | I0 **约定化分域注册**改造（每域一文件自动汇总）——消灭最大合并冲突面 |
| `web-dist/` 嵌入产物提交进仓（S-01） | **feature 分支不提交 web-dist 刷新**；main 合流时统一重建提交 |
| bun.lock / 根 package.json | engine 包空壳 I0 建好（`workbench/workbench-engine`，包名 `@devzero/engine`），之后各线少动 |
| docs/README.md / 决策记录（append 型） | 合流时手工解，可接受 |

### 4.3 worktree 规范

- 目录 `.worktrees/`（现状**未被 gitignore**——I0 补一行并提交）。
- 开工基线：每 worktree `bun install` + 全量测试绿才开工（using-git-worktrees 惯例）。
- 端口分配表（单例互斥体与端口是机器级资源，worktree 隔离不了）：

| 位置 | 端口 |
|------|------|
| main 产品 | 19980（默认） |
| main 冒烟 | 19981（沿用现状） |
| l1-create / l2-install / l3-engine | 19982 / 19983 / 19984 |
| l4-runtime / l5-kanban | 19985 / 19986 |

- **系统级全局状态只在 main 测试**（计划任务 / HKCU Run 键 / LOCALAPPDATA 安装目录 / 单例互斥体）——worktree 线内不做系统集成冒烟。
- 合流节奏：每 2~3 天向 main 小合流一次，禁止长漂移。
- 每线走 superpowers 流程（brainstorm → design → plan → subagent TDD），文档落 `docs/plans/`。
- `.ieidev`：暂不处理（D-038）。

---

## 5. 迭代计划

### I0 · 地基与契约（main，约 2-3 天）

| # | 任务 | 产出 | 验收锚 |
|---|------|------|--------|
| 0-1 | 裁决落档 | 决策记录 D-036~D-038 + 本路线图 | 用户确认 |
| 0-2 | 编排设计 brainstorm | `docs/plans/<日期>-协同编排-design.md`（内置 team 形态 / 主控驱动 / MCP 工具面 / events+node-table+SSE schema） | 评审 🟢 |
| 0-3 | M2 三份详细设计评审 | shared-protocol / 员工业务 / 安装适配 🟡→🟢 | 评审 |
| 0-4 | 契约冻结落仓 | 四件套 schema 真源文件进仓 | schema 评审通过 |
| 0-5 | Web 壳补全 + 注册约定化 | **F-02 导航骨架 / F-03 登录与接入页 / F-04 顶栏全局态**（M1 前端欠账——框架波次只交付了 F-01 壳）；service + web 注册点分域约定化；engine 包空壳 | 既有测试全绿 + 向导/看板路由占位可挂 |
| 0-6 | worktree 地基 | `.gitignore` 补 `.worktrees/` + 端口表落档（§4.3） | `git check-ignore .worktrees` 通过 |

### I1 · 三线并行（约 1 周）

**L1 员工新建**（`.worktrees/l1-create`）：E-01~03 真源（zod schema + 校验）→ E-11 五步向导（模板预置 dev-engineer / req-architect）→ E-12 包构建（AGENTS.md 渲染 / skills 锁版本复制 / manifest / mcp.json / orchestration 骨架）→ E-13 AgentHub 拉取（实证 API + 本地导入降级）。
**验收锚**：向导五步一路默认下一步产出**过 schema 校验的完整员工包**；AgentHub 端到端拉取 + fingerprint 校验。

**L2 员工安装**（`.worktrees/l2-install`）：B-03 安装执行器（落位计划 + file 后端 + 事务回滚）→ B-01/B-02 CB + Qoder 落位（按 D-034 实证路径）→ B-04 安装报告 → B-05 卸载 → B-07 当值 → B-06 底座探测页。
**验收锚**：CB 真机安装 → 底座内可见身份与 skill → 卸载 diff 干净；Qoder 同链路复验（D-034 已解除真机卡点）。

**L3 编排引擎**（`.worktrees/l3-engine`）：TS 纯库 TDD 移植 1.0 语义——R1 状态机 / R2 节点图+guard / R3 gate（含 reflow、max_retries→terminal fail）/ events 账本 / node-table 加载；**MCP server spike ≤ 0.5 天**（Bun + MCP SDK；失败降级路径 = HTTP API 回报，spike 报告裁决）。
**验收锚**：**内置 demo-flow 四阶段表引擎级测试全绿**（advance / gate PASS / gate FAIL→reflow / 溢出→fail，demo.node-table.yml 等价表为验收用例）。

合流纪律：每 2~3 天一次小合流。

### I2 · 两线加入 + 编排闭环（约 1 周）

- **L4 员工运行**（`.worktrees/l4-runtime`）：manifest 扫描 → 运行时花名册；E-10 列表页（状态徽章两维正交）/ E-14 详情页裁剪 / E-15 安装历史；**SSE 通道 service 侧实现**（运行态数据管线，员工运行设计 §4.4——D-030 移出部分随 D-037 拉前）。
- **L5 任务看板**（`.worktrees/l5-kanban`）：SSE 消费 + 看板 UI——阶段卡推进 / 闸位停留 / 员工卡 dispatch 动画（参照 wb-board 原型 / QoderWaker 看板截图 / collab-board.html）。
- **引擎接入 service**：HTTP API + MCP server 上线；内置 team 员工包的 mcp.json 挂引擎工具。
- **内置 team 端到端 demo**：预置员工包 → 安装 CB → 看板发起 run → 主控驱动 → 看板实时推进（引擎真实推进为红线）。
- **M2 验收**：创建 → 拉 skill → CB 安装 → 底座内使用 → 卸载全链 + Qoder 复验（功能点清单 M2 口径）。

### I3 · 收口与演示打磨（约 1 周）

- 演示脚本：5 分钟演示剧本 + 驱动命令串收敛（demo-4stage-flow 教训：命令串越短越稳，双 run 时序坑整体消失的设计值得复刻）。
- Playwright e2e 全链 + M3 总验收（孤儿回收 / 端口冲突 / 崩溃恢复注入测试）。
- 文档回写：功能点清单（M2/M3 扩编排验收 + §9 L2 行拆分 + F-02 看板入口解隐）/ 白皮书 §10.1 拉前注记 / 决策记录状态刷新。
- **模式二裁决点**：依模式一实际体验裁决是否启动自动派发（spawn 底座 CLI = 拉前 V0.2 会话路由子集）。

### 依赖图

```
I0 契约冻结（四件套）
 ├─ E-01~03 ─────────────→ L1 新建 ──┐
 ├─ manifest 契约 ────────→ L2 安装 ─┤ I1 三线并行
 └─ node-table/events ───→ L3 引擎 ─┘
        │                       │
        │       L1+L2 合流 ──→ L4 运行（花名册 / SSE 通道）
        └── events/SSE 契约 ─→ L5 看板（fixture 先行）
                                    │
        I2 合流：引擎接入（HTTP+MCP）+ 内置 team demo + M2 验收
                                    │
        I3：e2e + 演示脚本 + 文档回写 + 模式二裁决点
```

---

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| MCP server（Bun/hono）技术未验证 | 中 | I1 引擎线内 spike ≤ 0.5 天；降级 = HTTP API 回报（spike 报告裁决） |
| events schema 中途漂移 | 中 | 契约只改 main + 设计修订记录；L5 fixture 先行可早暴露不一致 |
| 三线合流冲突 | 中 | I0 注册约定化 + web-dist 纪律 + 2~3 天小合流 |
| Qoder 安装链路 | 低（已缓解） | D-034 真机实证已解除落位 / CLI / AGENTS.md 三疑点；I2 复验即可 |
| 演示稳定性（1.0 教训：长命令串 / 时序坑） | 中 | 内置 team 驱动命令串收敛为固定模板；「引擎真实推进」为验收红线 |
| 并行会话资源 | 低 | 三线封顶（D-038）；每线独立 worktree 会话 |

---

## 7. 后续文档任务

| 文档 | 动作 | 时机 |
|------|------|------|
| 协同编排设计文档 | brainstorm 产出（§3 实现级定稿） | I0-2 |
| 各线 design + plan 文档对 | `docs/plans/<日期>-<线名>{,-design}.md` | 各线开工前 |
| 设计决策记录 | D-036~D-038 追加 | I0-1（本次已落） |
| 功能点清单 | 里程碑扩展 + §9 拆行 + F-02 解隐 | I3 回写 |
| 白皮书 v0.8 | §10.1 拉前注记 | I3 回写 |

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-25 | v0.1 初版：四项用户裁决落档（D-036~D-038）；三线两波次迭代计划定稿 |
