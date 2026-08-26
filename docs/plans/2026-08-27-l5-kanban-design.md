# L5 任务看板线设计（KB-01/KB-02）——SSE 消费 + 看板 UI + 发起任务表单（fixture 先行）

| 项 | 值 |
|----|-----|
| 版本 | v0.1 |
| 日期 | 2026-08-27 |
| 状态 | 🟡 待评审 |
| 性质 | 设计文档（design+plan 文档对之 design 篇）——KB-01/KB-02 两功能点的实现级方案 |
| 依据 | [协同编排设计 v0.1](2026-08-26-协同编排-design.md) 🟢（§7.3 events schema / §8 SSE 契约 / §9.1 引擎 11 操作 / §9.3 HTTP 面 / §9.4 发起操作面 / §3.3 demo 剧本 / §2 裁决 11）、[功能点分工总表 v1.0](2026-08-26-功能点分工总表.md) §3 协调规则、原型 `docs/prototype/workbench.html`（蓝系 token + lane/task-card/run-card/node-chain 语言）、1.0 参照 `agents-team feat/demo-4stage-flow` `docs/demo/collab-board.html`、QoderWaker 任务看板截图（`docs/references/QoderWaker/`） |
| 关联 | 同域引擎线（另一会话，`.worktrees/l3-engine`）实现同一契约，双方各自绿后联调 |
| 决策号 | 本文档用占位号（D-kb01~D-kbNN），合流 main 时统一编真号（分工表 §3 规则 2） |

---

## 0. 摘要

任务看板 = **events 事件流的实时视图**。本设计把 KB-01/KB-02 落为四层：**事件消费层**（六类事件类型 + SSE 订阅，可注入 mock source）→ **归并层**（pinia store，`applyEvent` 纯函数把事件流归并为任务视图状态）→ **派生层**（表快照 + 任务状态 → 阶段/节点渲染模型，零硬编码）→ **UI 层**（五阶段泳道 + 节点 chip + 员工 dispatch 卡 + 停靠高亮 + 评审流水）。发起任务表单（KB-02）按裁决 11 字段面调 `POST /api/engine/tasks` 开 run。**fixture 先行**：按 §7.3 schema 造四剧本事件流（正常推进/闸位暂停/reflow/终止），SSE 消费层对 mock event source 开发测试，不依赖引擎；引擎线实现同一契约后联调互换。

## 1. 范围与不在范围

**在范围（KB 两行）**：

- KB-01 看板 UI：五阶段阶段卡推进 / 闸位停留高亮 / 员工卡 dispatch 动画 / SSE 实时刷新；断线重连与事件回放（§8 契约）
- KB-02 发起任务表单：mode（团队选表 / 单员工动态建表）+ 底座 + 模型档位 + 工作区 + 需求文本 → 调引擎 HTTP `createTask` 开 run → 看板出卡
- fixture 设施（表快照 + 四剧本 + mock SSE/HTTP + dev 播放控制）

**不在范围（记演进，不做但架构不堵路）**：轮询降级（`GET /events?after_seq=`，EventSource 自动重连够 V0.1）；审批工作台聚合页（多任务停靠审批列表——V0.1 停靠高亮 + 卡内辅按钮）；历史任务区/失败任务区表（原型有、引擎归档接口未定）；OTLP 导出；dispatch usage/token 汇总展示（payload 已含，UI 只透出简版）。

## 2. 分层架构与文件布局

```
workbench-web/src
├─ api/
│  ├─ engine-events.ts      六类事件 TS 类型 + SSE 帧解析（纯函数）
│  ├─ engine-stream.ts      SSE 订阅层（EventSourceLike 可注入）
│  └─ engine-api.ts         HTTP 面：createTask/getTask/getFlows/confirmGate
├─ fixtures/
│  ├─ demo-flow.table.ts    demo-flow 12 节点表快照 + gate-pause 变体表 + 七员工 display 映射
│  ├─ scenarios.ts          四剧本事件序列生成器（纯函数：剧本 → EngineEvent[]）
│  ├─ mock-event-source.ts  EventSourceLike 的 mock 实现（剧本按节奏推帧）
│  └─ kanban-fixture-service.ts  fixture 运行时（mock HTTP + mock stream + 播放控制）
├─ stores/
│  └─ kanban.ts             applyEvent 纯函数 + pinia store（连接态/任务Map/流水）
├─ composables/
│  └─ use-kanban-runtime.ts 真实/fixture 运行时挑选（dev 或 ?fixture=1 → fixture；否则真实）
├─ components/kanban/
│  ├─ StageLane.vue         阶段泳道（阶段名 + 计数 + 节点 chips + 活跃 dispatch 卡）
│  ├─ NodeChip.vue          节点 chip（done✓/cur/pending/gate 徽记/paused）
│  ├─ DispatchCard.vue      员工派发卡（start 蓝呼吸动画 / done 消散）
│  ├─ GatePauseBar.vue      闸位停靠条（amber 高亮 + 放行提示 + 辅按钮）
│  ├─ EventFeedPanel.vue    评审流水（gate verdict / 人工 confirm / run 生命周期）
│  ├─ TaskBoardCard.vue     单任务大卡（头 + 停靠条 + 五 lane + 流水）
│  ├─ CreateTaskModal.vue   发起任务表单弹窗（KB-02）
│  └─ FixtureControls.vue   dev-only 剧本播放控制条
├─ views/
│  └─ KanbanView.vue        页面壳（装配 + 空态 + 发起入口）
└─ router/routes/kanban.ts  占位页 → KanbanView（分域注册约定，不动 index.ts）
```

分层依赖单向：`views → components → stores → api/fixtures`；`fixtures` 不进真实构建路径的运行时（`use-kanban-runtime` 在生产模式不 import fixture 模块——用动态 import 隔离，bundle 不夹带 dev 设施）。

## 3. 事件消费模型（api/engine-events.ts）

### 3.1 类型定义（对齐设计 §7.3，snake_case 原样）

```ts
type EngineEventType = 'run.created' | 'run.completed' | 'run.aborted' | 'transition' | 'gate' | 'dispatch'

interface EngineEventBase {
  seq: number          // 1-based 行号（SSE 重放锚）
  ts: string           // ISO 8601
  type: EngineEventType
  trace_id: string     // = task_id（run 贯穿）
  parent_seq: number | null   // 父事件 seq（因果链）
  actor: string        // 'driver' | 'engine' | emp-id | 'human'
  task_id: string      // 事件自带，前端兜底过滤锚
}
// 载荷按 type 判别联合（Discriminated Union），字段名严格对齐 §7.3 表：
run.created   { flow, title, workspace, display_name }
run.completed { final_node, duration_s }
run.aborted   { final_node, reason }
transition    { from, to, reflow?, forced_fail?, reason?, status }   // status=推进后状态快照
gate          { gate, kind, node, verdict, iter, reviewer, issues?, request_id? }
dispatch      { phase: 'start' | 'done', emp, dispatch_id, node?, status?, usage? }
```

外部数据不可信：类型守卫逐字段窄化，非法事件**不抛异常**——解析失败归一为 `{ ok:false }` 并丢弃（带 seq 记 warn 便于诊断），消费侧只处理 `ok:true`。这是 health.ts「字段全可选——外部对象不可信」同款纪律。

### 3.2 SSE 帧解析

`event: <type>` + `data: <JSON>` + `id: <seq>` → `EngineEvent`。data 是事件 JSON 行（含通用壳全量字段），解析 = JSON.parse + 类型守卫；帧缺 `id` 时事件仍可消费（seq 缺失仅影响去重，记 seq=-1）。

## 4. SSE 消费层（api/engine-stream.ts）

契约对齐设计 §8，接口形态（**EventSourceLike 可注入**——jsdom 无 EventSource，这也是测试前提）：

```ts
interface EventSourceLike {
  readyState: 0 | 1 | 2 | 3   // CONNECTING/OPEN/CLOSED（对齐 EventSource 常量语义）
  onopen/onerror 事件 + addEventListener(type, cb)
  close(): void
}
type SourceFactory = (url: string) => EventSourceLike

function createEngineStream(url: string, opts?: { factory?: SourceFactory }): EngineStream
// EngineStream：onEvent(cb) / onConnectionChange(cb) / close()
//   onEvent：六类事件统一出口（data 解析+守卫后回调）
//   onConnectionChange：'connecting' | 'live' | 'reconnecting' | 'closed'
```

| 契约点 | 实现口径 |
|---|---|
| 订阅粒度 | URL 拼 `?task_id=`（V0.1 看板用全量默认订阅）；事件自带 task_id，store 兜底过滤 |
| 事件帧 | `addEventListener(eventType)` 按六类 type 分别挂 + onmessage 兜底未知 type |
| 心跳 15s `:ping` | comment 帧原生 EventSource 自动忽略；mock source 用之验证「不进事件流」 |
| 断线重连 | 原生 EventSource 自动重连自动带 `Last-Event-ID`；消费层职责 = ① readyState/error → 'reconnecting' 状态、onopen → 'live' ② **seq 去重**：回放帧 seq ≤ 已见最大 seq 则跳过（append-only 幂等兜底，防服务端重放/多订阅窗口重叠）③ close 后手动重连不做（页面卸载即 close） |

## 5. 归并层与派生层（stores/kanban.ts）

### 5.1 applyEvent 纯函数（核心测试锚）

`applyEvent(state: KanbanState, ev: EngineEvent): KanbanState`——不可变更新，四剧本重放断言即 KB-01 的行为规格：

| 事件 | 归并语义 |
|---|---|
| run.created | 建任务卡：title/flow/display_name/workspace、status=in_progress、currentNode=null、lastSeq |
| dispatch(start) | activeDispatches[dispatch_id] = {emp, node, ts}（员工卡出现） |
| dispatch(done) | 移出 activeDispatches；status=error 时 blockedReason 记常驻错误（错误常驻卡面纪律⑥） |
| transition | currentNode=to；doneNodes += from（离开即完成）；reflow=true 时 doneNodes -= to（回流目标重置为活跃）；status 快照覆盖任务状态（gate_paused/blocked/completed 归一） |
| gate | gateRecords 追加（评审流水条目：gate/verdict/iter/reviewer/issues/by=actor）——**人工 confirm 也进流水**（纪律④） |
| run.completed | status=completed + duration_s |
| run.aborted | status=aborted + reason 常驻卡面 |

多任务：state.tasks 以 task_id 为键，混流事件按 task_id 分拣；全局 feed 滚动窗口 cap 200 条。

### 5.2 派生层 deriveBoard（零硬编码纪律①的落点）

`deriveBoard(table: TableSnapshot, task: TaskState): BoardViewModel`——**阶段/节点全部来自表快照**，换表自动跟随：

```ts
TableSnapshot { flow, display_name, nodes: [{id,name,kind,stage,emp?,human_gate?,model_tier?}], gate_specs }
BoardViewModel {
  stages: { name: string, nodes: NodeView[] }[]     // stage 字段聚组、按表序；无 stage 的节点归「未分组」
  // NodeView { id,name,kind, state: 'pending'|'active'|'done'|'failed'|'paused', gateBadge?: boolean }
}
```

节点态判定：id ∈ doneNodes → done；id == currentNode → active（任务 gate_paused 时该节点 paused 附加 amber）；reflow 目标已在 doneNodes 中被移除故自然回 active。阶段聚合渲染「闸位停靠时闸所挂阶段按活已干完显示」语义：paused 节点本身是闸，其上游节点保持 done（5.1 归并已保证）。

表快照获取通道（**契约歧义 A，见 §10**）：V0.1 经 `getTask(task_id)` 响应携带（fixture 服务即此形状）；UI 在 table 未到时渲染骨架态。

## 6. fixture 设施（fixtures/）

### 6.1 表快照与员工映射（demo-flow.table.ts）

- `demoFlowTable`：设计 §6.1 demo-flow 12 节点表（准入→需求核验→设计核验→开发实现→准出五阶段）的 TS 对象（= table.snapshot.yml 解析后形态）
- `demoFlowGatePauseTable`：变体表——n0-req `human_gate: true`（闸位暂停剧本用；兼验证换表跟随）
- `employees`：七员工 `{id → display 中文名}` 映射（display 来源歧义见 §10-B）

### 6.2 四剧本（scenarios.ts）

纯函数 `buildScenario(name, {taskId, title, workspace, startTs}): EngineEvent[]`，seq 1-based 连续、trace_id=task_id、parent_seq 因果链（advance 指回触发 dispatch.start、gate 指回评审派发）。事件间 ts 递增（demo 播放节奏由 mock source 控制，与生成解耦）：

| 剧本 | 表 | 事件序列要点 | 验收锚 |
|---|---|---|---|
| `happy-path` | demo-flow | run.created → 12 节点全链 dispatch(start/done) + transition + 5×gate PASS → run.completed | 五阶段推进全绿、节点 chip done/cur 翻转、员工卡出现/消散 |
| `gate-pause` | 变体表 | 推进至 n0-req（human_gate）→ transition{to, status:gate_paused} → 停靠（无事件若干秒）→ gate{verdict:approve, actor:human} → transition 续跑 → completed | 停靠 amber 高亮、人工 confirm 进流水（纪律④⑤） |
| `reflow` | demo-flow | 推进至 g-code-review → gate{verdict:FAIL, iter:1} → transition{to:n2-impl, reflow:true} → 重派 dispatch → gate PASS → completed | 回流节点重置 active、iter 递增可见、重派动画 |
| `abort` | demo-flow | 推进至 n1-design → dispatch done status:error → run.aborted{reason} | 终态卡 + 错误常驻卡面（纪律⑥） |

剧本自检测试（给引擎线的对齐锚）：四剧本断言 seq 连续、parent_seq 引用合法、六类事件载荷字段完备、首事件 run.created / 终事件 run.completed|aborted——**这份断言即事件契约的消费者侧测试**，联调时引擎真实事件流跑同一校验。

### 6.3 mock-event-source.ts

实现 `EventSourceLike`：构造时持剧本帧队列，`addEventListener(type)` 后按节奏（可配 ms/帧，测试配 0）`setTimeout` 逐帧派发；支持中途 `pause()`/`resume()`（gate-pause 演出停靠感）；`simulateError()` 触发 onerror + readyState=CONNECTING（重连测试）；`replayFrom(seq)` 模拟服务端 Last-Event-ID 回放（去重测试）。

### 6.4 kanban-fixture-service.ts

fixture 运行时实现与 `engine-api.ts` 同一接口 + `SourceFactory`：

- `createTask(payload)` → 按当前选中剧本生成完整事件序列 → 202 语义回 `{task_id}` → 剧本入队待播；`getTask(task_id)` → `{...taskState, table: <剧本对应表快照>, employees}`；`getFlows()` → demo-flow 清单
- `streamFactory(url)` → 共享的 MockEventSource（播放控制作用于它）
- 剧本播放：起播（createTask 后自动）/暂停/继续/重播 + 播放速度（FixtureControls 驱动）

### 6.5 dev 接线（use-kanban-runtime.ts）

`dev（import.meta.env.DEV）或 ?fixture=1` → 动态 import fixture 运行时；否则 → 真实 `EventSource` + fetch。生产 bundle 不含 fixture 模块（动态 import 隔离）。Vite dev 端口本线 19986（`bun run dev -- --port 19986`，CLI 参数不改共享 vite.config.ts）。

## 7. KB-02 发起任务表单（CreateTaskModal.vue）

字段面 = 设计 §2 裁决 11 / §9.4，提交载荷 1:1 `createTask` 参数（§9.1）：

| 表单项 | 控件 | 联动 | 载荷字段 |
|---|---|---|---|
| 协作模式 | 单选：团队协作 / 单员工 | 团队 → flow 下拉（getFlows）；单员工 → 员工下拉（fixture 静态七员工；真实源歧义见 §10-C） | mode: 'team'\|'solo'，flow / employee |
| 任务标题 | 文本输入 | 必填 | title |
| 底座 | 下拉 CC / CodeBuddy / Qoder（静态三选，探测接口是 B-06 李线） | — | base |
| 模型档位 | 下拉（五档位 + 「跟随底座默认」空值）+ 手输兜底 | 勾选「使用流程阶段内置档位」→ 任务级 model/effort 置空禁用（表 model_tier 优先，§9.4 四层链） | model / effort + useFlowTier 复选（复选不改 payload 形状——勾选即提交空 model/effort） |
| 工作区 | 文本输入（路径手输；必填） | — | workspace |
| 需求文本 | textarea（必填） | — | input |

提交 → `createTask(payload)` → 202+task_id → 关弹窗 + 立即以 task_id 建占位卡（run.created 到达补全）+ fixture 模式自动起播剧本。校验：必填缺失按钮禁用 + 逐项错误文案；失败错误**常驻弹窗表单区**（非 toast，同纪律⑥）。

## 8. UI 结构与视觉

```
KanbanView（/kanban）
├─ page-head：h1「任务看板」+ sub + [发起任务] 主按钮 + FixtureControls（dev-only）
├─ ConnectionBar：SSE 连接态（live 绿点 / reconnecting amber / closed 灰）——board-pulse 形态
├─ 空态：无任务时居中空卡（Placeholder.vue 同款语言）
└─ TaskBoardCard × N（run-card 形态，一任务一卡）
   ├─ 头：title + 状态 tag（进行中蓝/gate 停靠 amber/阻塞红/完成绿/终止红）+ display_name + workspace + 耗时
   ├─ blocked/aborted 常驻红条（原因文案，非 toast）
   ├─ GatePauseBar：gate_paused 时 amber 高亮条 + 「在任务工作区开底座会话说『批准』即可放行」提示 + [通过]/[驳回] 辅按钮（confirmGate，对话式主通道之外）
   ├─ StageLane × 阶段数（demo 表 = 5 列 kanban-5，lane 形态）
   │   阶段名 + 节点计数 → NodeChip 列表（done✓蓝底 / cur 蓝实心+glow / pending 灰 / paused amber；gate 节点带 ⚖ 徽记）
   │   → 活跃 DispatchCard 挂在所派节点下（avatar + 员工名 + 派发动画：蓝 pulse 呼吸圈；done 后短停留消散）
   └─ EventFeedPanel：评审流水（gate PASS 绿/FAIL 红/人工 approve amber + run 生命周期行），最新在上，cap 展示 50
```

视觉对齐（原型 workbench.html 为唯一权威源，token 已在 `tokens.css`）：`kanban/kanban-5/lane/lane-head/cnt/task-card/run-card/node-chain/nc-node(done|cur)/nc-arrow/board-pulse/event-feed/event-item/tag/dot/avatar` 语言逐条沿用，scoped 样式自持子集（I0-5 T7 立的约定）。dispatch 动画 = `board-pulse` 同款 pulse 呼吸圈（`box-shadow` 扩散）+ 卡片边框呼吸，CSS keyframes 实现，无 JS 动画库。

品牌硬规则（CLAUDE.md §4）：页面文案一律「终端」不用「工作台」（如需提及服务，「终端服务」）；弹窗/按钮文案精简（「发起任务」「提交」「取消」）；不出现 DevZero 字样。

## 9. 测试策略（真红绿 TDD 锚）

每模块测试先行，测试文件 `test/*.test.ts` 对齐既有形态（vitest + @vue/test-utils + jsdom；纯函数直测，组件 mount 断言 DOM/类名/文案）：

| 模块 | 测试锚（先红后绿） |
|---|---|
| engine-events | 类型守卫矩阵（六类合法载荷通过/缺字段/错类型拒绝不抛）；帧解析（六类 type + 未知 type + 坏 JSON 容错） |
| scenarios | 四剧本自检（§6.2 契约断言——联调对齐锚） |
| engine-stream | 帧回调分发 / 连接状态机（open→live、error→reconnecting、close）/ seq 去重（replayFrom 重放跳过）/ 心跳 comment 不进事件流 / close 清理 |
| kanban store | applyEvent 单事件矩阵 + 四剧本全量重放断言（任务态/节点态/流水/activeDispatches 生命周期）+ 混流双任务分拣 |
| deriveBoard | 表驱动：五阶段聚合 / done-cur-pending 判定 / reflow 重置 / paused 附加 / 无 stage 节点兜底 |
| NodeChip/StageLane | 类名与文案按 NodeView 态渲染；lane 计数；gate 徽记 |
| DispatchCard | start→pulse 类名 / done→消散态 / 员工名映射 |
| GatePauseBar | 显隐条件 + 提示文案 + 按钮事件（confirmGate 调用断言） |
| EventFeedPanel | gate/confirm/run 事件行渲染与配色类 |
| TaskBoardCard/KanbanView | 装配渲染（注入 store 态）/ 空态 / ConnectionBar 状态类 |
| CreateTaskModal | 字段联动矩阵（mode 切换 / 复选禁用）/ 必填校验 / 提交载荷形状（对 §9.1 参数逐字段）/ 失败常驻 |
| router | /kanban 指向 KanbanView（替换 Placeholder 断言更新） |
| use-kanban-runtime | dev/fixture/live 三态挑选 + 生产不 import fixture |

基线承接：main 实测 web 224 全绿（交接基线数字 224 一致）；service 126 全绿（交接说 101，main 已增长，以实测为准）。本线新增测试不动既有测试（placeholder.test.ts 若专测 kanban 占位则随路由替换改写，属行为变更非破坏）。

## 10. 契约歧义与待裁决（不自创接口，记录对齐）

| # | 歧义 | 临时立场（fixture 口径） | 需对齐方 |
|---|---|---|---|
| A | **表快照到看板的通道**：run.created 不含 table；getTask 响应形状未定 | fixture `getTask` 返回 `{...state, table, employees}`；UI 对 table 未到渲染骨架 | 引擎线（HTTP getTask 响应定稿） |
| B | **员工 display 名映射来源**：事件只有 emp id，UI 显示中文名需映射 | fixture 内置七员工映射随 getTask 下发 | 引擎线/L4 registry（查询面未定） |
| C | **solo 模式员工清单查询面**：11 操作无员工清单 | fixture 静态七员工下拉 | 引擎线/L4 |
| D | **gate 事件 node 字段语义**（闸 id vs 被评节点） | fixture 定 node=闸 covers 的被评节点（如 g-req-review 事件 node=n0-req） | 引擎线（事件生成处） |
| E | 模型下拉真实数据源 `listModels(base)`（L2 adapter） | fixture 五档位+手输 | L2 安装线 |
| F | dispatch done 的 status 取值集 | fixture 定 'ok'\|'error' | 引擎线 |

以上在联调前与引擎线会话逐条对齐；fixture 侧结论以引擎侧真源为准修订（fixtures 单文件收敛，改动面小）。

## 11. 验收清单

| # | 断言 | 结果（2026-08-27 走查） |
|---|---|---|
| K1 | 全量测试绿（基线 224 + 新增全绿）+ typecheck 绿 | ✅ 354/354（基线 224 + 新增 130）+ tsc 干净 |
| K2 | fixture 演出：happy-path 五阶段推进、员工卡 dispatch、流水滚动 | ✅ 浏览器实操（截图 screenshots/2026-08-27-l5-kanban-*.png，主仓工作区） |
| K3 | gate-pause 停靠高亮 + 人工 confirm 进流水 + 续跑；reflow 节点重置与 iter；abort 终态常驻 | ✅ 四剧本全闭环（停靠→辅按钮放行→已完成；FAIL:1→PASS:2；已终止+常驻红条） |
| K4 | 断线重连：reconnecting 态 + 回放去重 | ✅ 测试级（engine-stream 12 测含 per-task 分域去重回归锚）；浏览器级真实断线路径待引擎线联调（mock 无真断线源） |
| K5 | 表单载荷逐字段对齐 §9.1；出卡链路 | ✅ 测试逐字段 + 浏览器实操（占位卡→run.created 补全→表快照渲染） |
| K6 | 换表跟随（变体表） | ✅ gate-pause 变体表渲染自动跟随 |
| K7 | 零硬编码抽查 | ✅ deriveBoard 表驱动（改名跟随测试锚） |
| K8 | 品牌：无「工作台」文案、无 DevZero；按钮精简 | ✅ grep 干净 + 页面标题/文案走查（「跟随终端默认」等「终端」用词） |

走查实捕修复三件（均含回归锚）：① seq 去重按 task_id 分域（原全局累计把新任务同号帧误吞——seq 是 per-task 事件文件行号，§7.3）② fixture 流 emitOpen 顺序（先建流再 open，否则连接条滞留「连接中」）③ 人工闸辅按钮 → confirmGate 接线遗漏。

## 12. 决策记录（占位号，合流时编真号）

| 占位号 | 决策 |
|---|---|
| D-kb01 | SSE 消费层 EventSourceLike 可注入（测试前提 + fixture 先行的结构保证） |
| D-kb02 | 归并层 applyEvent 纯函数 + 剧本重放测试 = 看板行为规格（事件流→UI 状态的唯一映射点） |
| D-kb03 | 表快照 + 员工映射经 getTask 随任务下发（待 A/B 裁决的临时口径） |
| D-kb04 | fixture 模块动态 import 隔离，生产 bundle 不含演出设施 |
| D-kb05 | 闸位停靠看板辅按钮（通过/驳回）实做 confirmGate；主通道对话式提示文案引导 |

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-27 | v0.1 初版：四层架构（消费/归并/派生/UI）+ fixture 四剧本 + 表单字段面 + 契约歧义六条 + 验收 K1-K8 |
| 2026-08-27 | 验收回写：T1~T11 全绿（354 测试），K1~K8 逐条勾；走查实捕修复三件（seq 分域去重/emitOpen 顺序/辅按钮接线） |
