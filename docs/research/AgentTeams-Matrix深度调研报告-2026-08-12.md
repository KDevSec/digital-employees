# AgentTeams / Matrix 深度调研报告

> 调研日期：2026-08-12
> 方法：四路并行深度调研 workflow（5 agents，42 万 token，168 次工具调用）
> 前置文档：[AgentTeams-Matrix 借鉴分析 v2](AgentTeams-Matrix借鉴分析-多智能体底座兼容方案-2026-08-11.md)（已基于本报告修正）
> 关联决策：[Q 20260812-054528](../../.ieidev/memory/shared/决策日志.md)（单 Agent 形态定调）

---

## 目录

1. [调研方法](#1-调研方法)
2. [核心发现：Matrix 协议真实形态](#2-核心发现matrix-协议真实形态)
3. [核心发现：AgentTeams 产品架构](#3-核心发现agentteams-产品架构)
4. [核心发现：竞品通信协议横向对比](#4-核心发现竞品通信协议横向对比)
5. [核心发现：架构差距评估（1.0 存量 vs 2.0 绿地）](#5-核心发现架构差距评估10-存量-vs-20-绿地)
6. [修订后路线图](#6-修订后路线图)
7. [通信架构调研：本地发现 + 远程协作 + A2A 定位](#7-通信架构调研本地发现--远程协作--a2a-定位)
8. [未决问题（修订）](#8-未决问题修订)

---

## 1. 调研方法

四路并行调研，每路先读借鉴分析 v1 文档，然后各自深挖：

| 调研路 | 主题 | 方法 | token |
|--------|------|------|-------|
| ① matrix-source-code | Qwen-Agent 源码 + Matrix 协议真实形态 | WebFetch GitHub 仓库 + gh 代码搜索 | 78k |
| ② agentteams-architecture | AgentTeams 产品架构细节 | WebFetch 帮助文档 + WebSearch 技术博客 | 74k |
| ③ competitor-protocols | 竞品通信协议横向对比 | WebSearch AutoGen/CrewAI/LangGraph/Swarm/A2A | 71k |
| ④ arch-gap-analysis | 我们架构的代码级差距 | Read 本项目代码 + 文档盘点 | 139k |

综合阶段：首席架构师 agent 综合四路结果产出结构化报告。

---

## 2. 核心发现：Matrix 协议真实形态

### 2.1 ❌ v1 文档的核心假设被推翻

**v1 假设**："Matrix 被定位为'AI Agent 的 HTTP'——一个开放的、厂商中立的、标准化的多智能体通信协议。"

**实证结论**：**不成立**。Matrix 就是 matrix.org 的开放联邦化 IM 协议（spec.matrix.org 治理），不是 AI Agent 间通信协议。AgentTeams 实例内置 Matrix Server + Element UI 连接点，Element UI 即 matrix.org 旗舰客户端。置信度：high。

### 2.2 Qwen-Agent 仓库实测

| 检查项 | 结果 |
|--------|------|
| 仓库地址 | https://github.com/QwenLM/Qwen-Agent（Apache 2.0，✅ 存在） |
| AgentTeam 模块 | **不存在**。`gh api search/code q='AgentTeam repo:QwenLM/Qwen-Agent'` 返回 total_count: 0 |
| Matrix 协议 | **不存在**。仓库内无 Matrix 相关代码 |
| 真实多 agent 基类 | `MultiAgentHub`——极简，仅要求 `_agents` 列表且 name 唯一 |
| 真实消息格式 | Message 类 6 字段：role / content / reasoning_content / name / function_call / extra。role 只允许 system/user/assistant/function（**不是** v1 说的 `user\|assistant\|system\|function\|agent`） |
| 真实协作模式 | GroupChat 四种 speaker selection 策略：manual / round_robin / random / auto（**不是** v1 说的五种 Sequential/Pipeline/Broadcast/Debate——那些是 AutoGen 的） |
| 2026 开源计划 | **编造**。WebSearch 给出的具体 URL 全部 404 |

### 2.3 影响修正

| v1 内容 | v2 修正 |
|---------|---------|
| §2.1 表格"Qwen-Agent 开源项目的 Matrix 协议 ✅ Apache 2.0" | ❌ 删除。Qwen-Agent 有多 agent 机制但无 Matrix 协议 |
| §2.2 Matrix 消息格式引用 | 修正为 Qwen-Agent GroupChat 格式（6 字段，无 agent_id） |
| §2.3 五种协作模式矩阵 | 标注为 AutoGen 分类法（四策略才是 Qwen-Agent 的） |
| §5.7 Matrix 开源协议前瞻兼容 | ❌ 整节删除。前提不成立 |
| §5.3 IM 人在回路 | ✅ 保留且更清晰——直接用 matrix.org 开源生态 |

### 2.4 Matrix 的残余价值

Matrix（matrix.org）在数字员工套件中仍有**独立价值**，但定位是 **IM 人在回路**而非 Agent 间通信：

- Phase 6+ IM 集成可直接采用 matrix.org Element 客户端 + 钉钉/飞书/企微桥接
- 不需要等阿里云开源（matrix.org 本身就是开源的）
- 与 Agent 间通信协议无关——Agent 间通信走我们自己的 handoff 协议

---

## 3. 核心发现：AgentTeams 产品架构

### 3.1 产品定位

AgentTeams 是公测中的 SaaS 多智能体治理平台，非开源框架。核心功能 7 项（实例管理 / Worker 管理 / 模型管理 / 团队协作 / MCP 服务 / 监控仪表盘 / Worker 模板），依赖 9 个云产品。实例是资源隔离边界（模型配置/Worker/团队/MCP/Skill 五项独立隔离）。仅杭州/北京/新加坡三个公有云地域，无私有化部署选项。

### 3.2 可借鉴的设计模式

| 设计模式 | AgentTeams 实现 | 借鉴价值 | 兼容性 |
|---------|----------------|---------|--------|
| **WAT 双身份** | Agent 身份 + 操作人员身份，确保操作可追溯 | ✅ 高——印证 employee_id + operator_id + base_id 三元组方向 | 本地可用 |
| **三链 Trace** | 调用链/工具链/决策链，写入 CMS + SLS | ✅ 高——语义分层值得固化到白皮书观测章节 | 语义对齐 |
| **Skill 版本治理** | 草稿→已发布→已下线 + 内容审核 + 公开/私有 + NPX 下载 | ✅ 中——我们 SKILL.md 目前无版本治理 | 本地可用 |
| **MCP 两种远程模式** | HTTP TO MCP（Swagger）+ 直接代理（SSE/Streamable HTTP） | ✅ 中——当前只支持 command 模式 | 本地可用 |
| **凭证隔离安全网关** | 架构级内存加密 + Anti-Log + 缓存清除 | ❌ 云多租户设计 | 不兼容 |
| **Team 池化 RBAC** | 管理员创建 Team 池 + RBAC 配额 | ❌ 云多租户设计 | 不兼容 |

### 3.3 AgentTeams 是竞争对手/纳管平台

AgentTeams 官方明确支持异构存量 Agent 零改造纳管，官方原文点名"OpenClaw、QwenPaw、Claude Code、自研 Agent 等"混编进同一 Team。

**含义**：AgentTeams 可能成为数字员工套件的外部纳管者——它可以把 Claude Code（我们的底座之一）作为存量 Agent 纳管。这意味着 AgentTeams 在产品层级上是竞争对手，不是技术底座。

---

## 4. 核心发现：竞品通信协议横向对比

### 4.1 横向对比矩阵

| 框架 | 消息格式 | 路由机制 | 通信模式 | 开放标准 | 本地运行 | 与 MCP 关系 |
|------|---------|---------|---------|---------|---------|------------|
| **LangGraph** | TypedDict/Pydantic State + Command(goto) | 图结构（StateGraph） | 条件路由/子图 | ❌ 框架 | ✅ 纯本地 | 可集成 |
| **OpenAI Swarm** | 函数返回 Agent 对象 | 去中心化（handoff 函数） | 点对点 handoff | ❌ 框架 | ✅ 纯本地 | 无 |
| **AutoGen v0.4** | HandoffMessage{source,target,context} + TopicId pub/sub | GroupChat 中心化 + Swarm 去中心化 | 广播/点对点/委派 | ❌ 框架 | ✅ 纯本地 | 可集成 |
| **CrewAI** | function-calling（delegate_task/ask_for_help） | Hierarchical Manager Agent | 委派 | ❌ 框架 | ✅ 纯本地 | 可集成 |
| **FIPA ACL** | 结构化 slot（sender/receiver/content/protocol...） | receiver 字段 | 20+ performatives | ✅ IEEE/FIPA | ✅ | 无 |
| **Google A2A** | JSON-RPC 2.0 over HTTP/SSE | Agent Card 发现 | 点对点 | ✅ Linux Foundation | ❌ 需 HTTP | 可共存 |
| **Qwen-Agent** | dict 消息 6 字段 + name 路由 | GroupChat 中心化 | 4 种 router | ❌ 框架 | ✅ 纯本地 | 可集成 |

### 4.2 最接近我们需求的方案

**LangGraph 是架构骨架最接近的**：
- StateGraph 的图节点 = R2 transition（节点流转）
- 共享 State = R1 状态机（flow-state.json）
- SqliteSaver 每步持久化到本地 .db ≈ 我们的文件基底不变量
- 原生支持断点续跑 / human-in-the-loop / time-travel
- **借鉴方式**：用 YAML/JSONL 文件替代 SQLite（保持纯文件基底），借鉴 State reducer + checkpointer 思路

**OpenAI Swarm 的 handoff 原语最简洁**：
- 一个返回 Agent 对象的 Python 函数即触发控制转移
- 对话历史全量保留、system prompt 切换
- 显式 stateless（caller 须把 messages+agent+context_variables 回传）
- **借鉴方式**：stateless + caller 回传模式完美映射我们的文件 handoff；handoff_input_filter（控制传递给下一 agent 的上下文，防 prompt 注入）值得直接借鉴到 gate handoff 的 payload 裁剪

**FIPA ACL 的 schema 词汇最丰富**：
- 结构化 slot（sender/receiver/content/language/ontology/protocol/reply-with/in-reply-to/reply-by）
- 20+ performatives（inform/request/query-ref/agree/refuse/cancel/failure）
- **借鉴方式**：槽位结构 1:1 映射 handoff-message.yml（sender→from、receiver→to、content→payload、protocol→type、reply-with/in-reply-to→reply_to、ontology→capability 路由依据）。只借结构不借 SL 模态逻辑语义

**Google A2A 是真开放标准**：
- Linux Foundation 托管，Apache 2.0，25.3k stars
- JSON-RPC 2.0 over HTTP(S)/SSE
- Agent Card 发现机制 ≈ 我们的能力路由
- **借鉴方式**：Phase 3 远期适配器目标（外部 Agent 接入）。因 HTTP 栈与零网络不变式冲突，定位为外部接口适配器，内部协议不变

### 4.3 结论

**单一 Matrix 不是最佳借鉴对象**。多源混合借鉴方案更契合需求（Matrix 以协议模式参考 + 远期 IM 对接身份回归借鉴列表）：

```
我们的 handoff-message.yml 设计灵感：
  ├── 字段结构  → FIPA ACL 槽位（sender/receiver/content/protocol/reply-with/in-reply-to）
  ├── handoff 语义 → OpenAI Swarm（stateless + caller 回传 + input_filter）
  ├── 状态持久化 → LangGraph（checkpointer 思路，用文件替代 SQLite）
  ├── 协议模式  → Matrix/matrix.org（房间联邦 + 事件溯源 + 客户端-服务器模型）
  │              → inbox/outbox = 通信房间；events.jsonl = DAG 事件流；
  │                flow-driver = homeserver，agent = client
  │              → Phase 3 IM 对接：Element 客户端直接加入已有 handoff 房间
  └── 远期外部接入 → Google A2A（适配器层，不是内部协议变更）
```

---

## 5. 核心发现：架构差距评估（1.0 存量 vs 2.0 绿地）

> ⚠️ 本节基于 1.0 代码盘点。单 Agent 形态定调后（[Q 20260812-054528](../../.ieidev/memory/shared/决策日志.md)），这些发现对 2.0 绿地设计参考价值有限——降级为"1.0 迁移参考"而非"2.0 设计需求"。

### 5.1 1.0 存量：5 种 ad-hoc handoff schema

当前 1.0 的 handoff 机制"一机三用"，实际存在 5 种碎片化 JSON schema：

| 场景 | 当前 schema | 字段 |
|------|------------|------|
| 同流主循环↔业务 agent（最高频） | CLI handoff-write/read | node_id/employee/status/summary/artifacts/gate_input/reason |
| 跨员工交付 | 同 CLI handoff | 同上 |
| reviewer request | request.json | caller/capability/target |
| reviewer handoff | handoff.json | verdict/score/details |
| CQO request/handoff | request.json + handoff.json | caller/slug（字段又不同） |

### 5.2 2.0 形态下的范围收窄

单 Agent 形态定调后，handoff 协议范围大幅收窄：

| 1.0 场景 | 2.0 是否需要 |
|---------|-------------|
| 同流主循环↔业务 agent（intra-flow） | ❌ 不需要——单 Agent 内部是 skill 调用（subagent dispatch），不是 agent 间 handoff |
| 跨员工交付 | ✅ 需要 → `delivery_handoff` |
| reviewer request/handoff | ✅ 需要 → `review_request` + `review_verdict` |
| CQO request/handoff | ✅ 需要 → 复用 `review_request` + `review_verdict`（CQO 本质也是评审） |
| 人工闸 | ✅ 需要 → `human_gate` |

**2.0 只需 4 种消息类型**（不是 v1 基于多 Agent 分析提出的 9 种）。

### 5.3 1.0 迁移参考（降级）

以下 1.0 存量分析对 2.0 绿地设计的参考价值有限，但迁移时需注意：

- **dispatch_table 7 条条目**：1.0 的 reviewer.dispatch-table.yml 有 7 条路由。2.0 单 Agent 形态下能力路由走 manifest 的 provides/requires 声明，不需要硬编码 dispatch_table。迁移 = 7 条条目转为能力声明。
- **13 个 gate 路由**：1.0 的 13 个 gate 依赖 dispatch_table 反查。2.0 走动态匹配算法。
- **"一机三用"CLI handoff**：1.0 用同一套 CLI handoff-write/read 覆盖三层场景。2.0 只有员工群组层需要 handoff 协议。

### 5.4 白皮书 §4.5 修订需求

白皮书 v0.4 §4.5"Agent 主从结构：主人设 + 能力 agent"与单 Agent 形态矛盾，需修订为"Agent + Skill 结构"：

| v0.4 §4.5（多 Agent） | v0.5 修订方向（单 Agent） |
|----------------------|------------------------|
| 员工 = 1 主人设 + N 能力 agent .md | 员工 = 1 Agent（主人设 AGENTS.md）+ N Skill（SKILL.md） |
| agents/ 子目录有多个 .md | skills/ 子目录有多个 SKILL.md |
| 能力 agent 被 orchestrator 派发时接收主人设上下文 | skill 调用时开独立会话（subagent dispatch），避免上下文污染 |
| staff.yml 多 agent 花名册 | manifest.yml 能力声明（provides/requires） |

---

## 6. 修订后路线图

```
Phase 1（P0，4-6 周）——handoff 标准化 + 身份模型 + 文档纠偏
  ├── 文档修订（1 周）✅ 已完成（本报告 + v2 修正）
  ├── handoff-message.yml v0.1（2-3 周）
  │   ├── 多源混合借鉴：FIPA ACL 槽位 + Swarm handoff 原语 + LangGraph 持久化思路
  │   ├── 4 种消息类型（delivery_handoff / review_request / review_verdict / human_gate）
  │   └── 文件基底（YAML），零网络依赖
  ├── 统一身份模型（1-2 周）
  │   ├── manifest schema 引入 schema_version
  │   └── 新增 employee_id / base_identity / operator_id 三元组
  └── 三链 Trace 语义固化（0.5 周）
      └── 白皮书观测章节明确调用链/工具链/决策链与 OTLP span 映射

Phase 2（P1，6-8 周）——UPP v0.3 + 能力路由
  ├── UPP v0.3 纳入 handoff 协议为第五维度（1-2 周）
  │   └── 定义 schema 规范、inbox/outbox 目录结构、消息类型枚举、TTL 与 reply_to 约定
  ├── 能力路由迁移（3-4 周）
  │   ├── dispatch_table → provides/requires 能力声明
  │   └── 设计动态匹配算法
  ├── Skill 版本治理（2 周）
  │   └── 借鉴 AgentTeams 草稿→已发布→已下线生命周期
  └── MCP 远程集成扩展（1 周）
      └── 借鉴 AgentTeams HTTP TO MCP + 直接代理两种模式

Phase 3（P2，8-12 周）——生态扩展（方向调整）
  ├── A2A 协议适配器（4-6 周）
  │   └── 作为外部 Agent 接入的目标协议（替代原 Matrix 方向）
  ├── IM 人在回路（2-3 周）
  │   └── 直接采用 matrix.org Element 客户端 + 钉钉/飞书/企微桥接
  └── 跨底座 Team 混编（3-4 周）
      └── 解决跨底座 handoff 路由（dev-engineer 跑在 CC、reviewer 跑在 opencode）
```

---

## 7. 通信架构调研：本地发现 + 远程协作 + A2A 定位

> 本节为 2026-08-12 补充调研。用户提出两个关键场景（本地组 team / 远程组 team），围绕 A2A 协议在数字员工套件中的定位展开讨论。以下为基于 A2A 官方规范实证的结论。

### 7.1 核心前提：员工 vs 工作台 vs 管控平台

数字员工是**扩展配置**（AGENTS.md + skills + hooks + mcp.json），不是运行中的进程，没有 HTTP endpoint，不能直接讲 A2A。能讲 A2A 的是：

| 组件 | 是进程？ | 有 HTTP endpoint？ | 能讲 A2A？ |
|------|---------|------------------|----------|
| 数字员工（扩展配置） | ❌ 一堆文件 | ❌ | ❌ |
| 工作台（本地运行时） | ✅ 运行中 | ✅ localhost:8765 | ✅ **是 A2A 的正确载体** |
| 管控平台（远端 Web 服务） | ✅ 运行中 | ✅ 公网 | ✅ 远端 relay + 治理 |

**结论**：A2A 不在员工层，在工作台层。工作台是本地员工的"A2A 桥梁"——收到 A2A 请求后翻译成本地文件 handoff 交给员工执行。

### 7.2 本地组 team（同机器跨底座）

**场景**：Qoder 安装了 dev-engineer，Claude Code 安装了 req-architect，工作台需要发现它们、知道装在哪个底座、是否在运行、任务进度如何。

**A2A 适用吗？** 不适用——A2A 是 HTTP 协议，本地 CLI 底座没有 HTTP endpoint。本地发现用文件：

#### 安装注册表（发现）

UPP 安装时写共享注册表：

```yaml
# ~/.ieidev/registry.yml —— 跨底座安装注册表
employees:
  - employee_id: "dev-engineer@team-ieidev"
    base: "qoder"
    install_path: "~/.qoder/plugins/ieidev-dev-engineer/"
    version: "1.0.0"
    installed_at: "2026-08-12T10:00:00"
    
  - employee_id: "req-architect@team-ieidev"
    base: "claude-code"
    install_path: "~/.claude/plugins/ieidev-req-architect/"
    version: "1.0.0"
    installed_at: "2026-08-12T11:00:00"
```

#### 运行状态 + 进度（跟踪）

工作台 HUD 服务（已有）扫描所有项目的 `.ieidev/flow-state.json` → 发现 active flow → 读 current_node / current_step / progress → SSE 推送到 UI。

#### Matrix 房间模式映射

| Matrix 概念 | 我们的实现 |
|------------|-----------|
| Room（房间） | registry.yml 里一条安装记录 |
| Room 事件流 | events.jsonl（append-only） |
| Room 状态 | flow-state.json（当前节点/步骤/进度） |
| 成员加入/离开 | 员工启动/停止 |

### 7.3 远程组 team（跨机器跨真人）

**场景**：开发者 A 的 dev-engineer ↔ 开发者 B 的 reviewer，需要跨机器协作。

**A2A 适用的前提**（官方规范实证）：A2A 采用**直接的 Client/Server 二元模型**——Server 侧**必须有公网可达 URL**。规范原文（[a2a-protocol.org/latest/specification](https://a2a-protocol.org/latest/specification/)）：

> "A2A Client：代表用户或其他系统发起请求的应用程序。A2A Server (Remote Agent)：暴露 A2A 兼容端点、处理任务并提供响应的代理系统。整个协议规范中不存在中间节点角色。"

A2A 三种更新机制的可达性要求：

| 机制 | 连接方向 | 客户端可在 NAT 后？ | Server 需公网可达？ |
|------|---------|------------------|------------------|
| 轮询（Get Task） | Client → Server | ✅ 可以（出站） | ✅ 必须 |
| 流式（SSE） | Client → Server | ✅ 可以（出站） | ✅ 必须 |
| 推送通知（Webhook） | Server → Client | ❌ **不行** | ✅ 必须 |

**关键发现**：当两个工作台都在 NAT 后时，A2A 直连不可能——Server 侧没有公网 URL，Push Notification 的 webhook 接收方也需公网可达。**A2A 协议自身不提供 relay/broker 解法**。

> ⚠️ 纠错记录：WebSearch 早期结果声称"A2A spec 有 relay broker pattern / NAT traversal section"——这是搜索引擎的合成推断。实测取官方规范后确认不成立，规范里没有 relay/broker/NAT traversal 的任何定义。GitHub 仓库 README 也确认协议假定 agent 之间可通过 HTTP(S) 直连。

### 7.4 管控平台作为中继是必需的

A2A 不解决的场景，管控平台补位：

```
工作台 A（NAT 后）           管控平台（公网）           工作台 B（NAT 后）
  │                            │                            │
  │  1. A 连平台（出站 HTTP）   │                            │
  │───────────────────────────▶│                            │
  │                            │  2. B 也连平台（出站 HTTP）  │
  │                            │◀───────────────────────────│
  │                            │                            │
  │  3. A 发 handoff 给 B      │                            │
  │─────── HTTP POST ─────────▶│ 4. 平台中继给 B              │
  │                            │─────── HTTP POST/SSE ──────▶│
  │                            │                            │
  │                            │ 5. B 返 verdict             │
  │                            │◀─────── HTTP POST ──────────│
  │  6. 平台回传给 A            │                            │
  │◀─────── HTTP/SSE ─────────│                            │
```

管控平台在 A2A 层面 = "公网 relay + 治理层"：公网可达 endpoint（双方都能出站连到）、task 中继（缓冲/排队/超时管理）、治理（授权/审计/成本归集）。

### 7.5 A2A 的 Client/Server 模型

A2A 基于 JSON-RPC 2.0，有 client/server 区分但**按请求角色切换**，不是固定分配：

- **Server 侧**：暴露 Agent Card（`/.well-known/agent-card.json`）+ 接收 JSON-RPC 方法（tasks/send, tasks/get, tasks/sendSubscribe, tasks/cancel）
- **Client 侧**：发现其他 Agent Card + 发送 JSON-RPC 请求 + SSE 订阅进度
- **同一个 Agent 可同时是 client 和 server**——A 给 B 发任务时 A 是 client、B 是 server；B 反过来给 A 发任务时角色翻转

工作台需要实现**两侧**：Server（已有 HUD HTTP 服务，加 A2A 路由）+ Client（发 HTTP 请求给其他工作台）。

### 7.6 修正后的五层通信架构

```
Layer 0：同机器 → 文件 handoff（零网络）
  ┃  文件注册表 + flow-state 扫描
  ┃  handoff-message.yml 文件交接
  ▼
Layer 1：同网络 / 双方有公网地址 → A2A 直连（P2P）
  ┃  工作台互发 Agent Card 发现对方员工
  ┃  handoff-message.yml 走 A2A JSON-RPC 传输
  ┃  工作台自动探测：先试直连，连得上就走 P2P
  ▼
Layer 2：跨网络、双方 NAT 后 → 管控平台 relay
  ┃  A2A 直连失败 → 降级到平台中继
  ┃  消息格式不变（handoff-message.yml），只换传输路径
  ┃  平台做中继 + 治理（授权/审计/成本）
  ▼
Layer 3：外部 Agent 接入 → A2A 适配器
  ┃  非 ieidev 的 Agent 通过 A2A Agent Card 发现我们的员工
  ┃  A2A JSON-RPC ↔ handoff-message.yml 双向翻译
  ┃  仍走管控平台（治理不缺位）
  ▼
Layer 4：跨组织联邦 → Matrix federation
  ┃  不同组织的管控平台通过 Matrix homeserver 联邦
  ┃  Room = 跨组织 team workflow
  ┃  人类和 agent 在同一个 Matrix room 里
  ┃  IM 人在回路是同一个 room 的自然延伸
```

**关键设计原则**：

1. **消息格式始终是 handoff-message.yml**——无论哪一层，消息 schema 不变，只换传输层
2. **工作台是 Layer 0-1 的主体**——本地文件 + A2A 直连，不需要平台
3. **管控平台是 Layer 2-3 的主体**——relay + 治理，P2P 不通时的兜底
4. **自动降级**——工作台先试 A2A 直连（Layer 1），连不上降级到平台 relay（Layer 2），对用户透明
5. **A2A 不在员工层，在工作台层**——员工是配置文件不能讲 A2A，工作台是运行进程可以
6. **管控平台从"消息 broker"降级为"relay + 治理"**——P2P 能直连时不经平台，只在 NAT 挡住或治理需要时走平台

### 7.7 A2A 在架构中的定位总结

| 问题 | 答案 | 证据来源 |
|------|------|---------|
| 员工能直接讲 A2A 吗？ | ❌ 不能——员工是配置文件，不是进程 | 员工 = AGENTS.md + skills（文件），无 HTTP endpoint |
| 工作台能讲 A2A 吗？ | ✅ 能——运行进程 + 已有 HTTP endpoint | HUD 服务 localhost:8765（已有） |
| A2A 有 relay/broker 吗？ | ❌ 规范里没有 | [官方规范](https://a2a-protocol.org/latest/specification/)：只有 Client/Server 二元模型，无中间节点 |
| NAT 后双方能 A2A 直连吗？ | ❌ 不能——Server 需公网可达 | 规范：Agent Card 需 URL，Push Notification webhook 接收方也需公网可达 |
| 网络不通怎么办？ | 管控平台 relay | 平台是公网 Web 服务，双方都能出站连到 |
| "把员工接入任意 Agent"靠 A2A？ | ❌ 靠 UPP，不靠 A2A | UPP = 安装面（让员工装到任意底座）；A2A = 通信面（运行中 Agent 间对话） |
| A2A 的 client/server 固定吗？ | 不固定，按请求切换 | JSON-RPC 2.0 请求-响应模型，同一 Agent 可同时是 client 和 server |

---

## 8. 未决问题（修订）

1. **handoff-message.yml v0.1 的具体字段设计**——reply_to 是用消息 ID 还是 gate ID？TTL 默认值多少？payload 结构如何标准化？
2. ~~白皮书 §4.5 修订~~——✅ 已完成（v0.5 修订，单 Agent + 多 Skill 结构）
3. **能力路由匹配算法**——provides/requires 的语义是精确匹配还是模糊匹配？covered_nodes 多产物档怎么用能力路由表达？
4. ~~A2A 适配器的接入边界~~——✅ 已明确：A2A 在工作台层不在员工层；外部 Agent 走管控平台 A2A 适配器
5. **UPP v0.3 handoff 协议维度的目录约定**——inbox/outbox 放在 `.ieidev/handoffs/` 还是项目根 `handoffs/`？跨底座时怎么定位？
6. **LangGraph checkpointer 思路的具体借鉴方式**——是借鉴"每步持久化"理念还是借鉴 State reducer 模式？不引入 SQLite 的前提下，如何实现等效的 time-travel 能力？
7. **工作台 A2A 探测+降级机制**——Layer 1→Layer 2 的自动降级：超时多久判定直连失败？探测 Agent Card 的策略？降级后如何保持消息顺序？
8. **管控平台 relay 的 task 生命周期**——平台中继 task 的状态管理是否对齐 A2A 的 TaskState（submitted/working/input-required/completed/failed/canceled）？

---

## 附录：调研 workflow 元数据

| 项 | 值 |
|----|-----|
| 调研路数 | 4 路并行 + 1 综合 |
| 总 token | 421,469 |
| 总工具调用 | 168 |
| 总耗时 | ~21 分钟 |
| 零错误 | 0 agents error, 0 empty |
| 借鉴分析文档版本 | v1 → v2（基于本报告修正） |
| 关联决策 | [Q 20260812-054528](../../.ieidev/memory/shared/决策日志.md) 单 Agent 形态定调 |