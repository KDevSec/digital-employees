# TencentDB Agent Memory vs MemOS 深度对比——源码级实证

> 日期：2026-08-13
> 方法：两个仓库克隆到 `references/` 目录，直接读源码（非 WebFetch/搜索引擎）
> 源码位置：`references/tencentdb-agent-memory/` + `references/MemOS/`

---

## 1. 基本信息对比

| 维度 | TencentDB Agent Memory | MemOS（记忆张量） |
|------|----------------------|------------------|
| GitHub | [TencentCloud/tencentdb-agent-memory](https://github.com/TencentCloud/tencentdb-agent-memory) | [MemTensor/MemOS](https://github.com/MemTensor/MemOS) |
| License | MIT | Apache 2.0 |
| 语言 | TypeScript（Node.js >= 22.16） | Python（服务端）+ TypeScript（本地插件） |
| 包名 | `@tencentdb-agent-memory/memory-tencentdb-v2` v2.0.0-beta.1 | PyPI: `memos-ai` / npm: `@memos/local-plugin` |
| 定位 | OpenClaw 记忆插件（host-neutral facade） | Agent 记忆操作系统（Python 服务端 + 本地插件） |
| 本地部署 | ✅ Docker / npm 直装 | ✅ Docker / pip / npm |

> ⚠️ 纠错记录：之前多轮调研对 TencentDB 的包名、目录结构、功能有反复的幻觉。以下为源码级实证，从 `references/tencentdb-agent-memory/` 实际文件读取。

---

## 2. 架构对比

### TencentDB Agent Memory 架构

```
TencentDB-Agent-Memory/
├── MemoryCore/          核心记忆引擎（TypeScript）
│   ├── src/core/
│   │   ├── tdai-core.ts           ← TdaiCore：host-neutral facade（单一入口）
│   │   ├── conversation/
│   │   │   └── l0-recorder.ts     ← L0 原始对话记录
│   │   ├── prompts/
│   │   │   ├── l1-extraction.ts   ← L1 原子事实提取 prompt
│   │   │   ├── l1-dedup.ts        ← L1 去重
│   │   │   ├── scene-extraction.ts ← L2 场景知识提取 prompt
│   │   │   └── persona-generation.ts ← L3 用户画像生成 prompt
│   │   ├── scene/                  ← L2 场景管理（extractor/index/navigation/format）
│   │   ├── persona/                ← L3 画像管理（trigger）
│   │   ├── skill/                  ← Skill 模块（core/extractor/versioning/store/tools）
│   │   ├── hooks/                  ← auto-recall + auto-capture
│   │   ├── tools/                  ← memory-search + conversation-search
│   │   ├── store/                  ← 存储层（SQLite + sqlite-vec + TencentDB VectorDB）
│   │   └── utils/                  ← pipeline-factory（createL1/L2/L3Runner）+ checkpoint
│   ├── openclaw.plugin.json        ← OpenClaw 插件配置
│   └── SKILL.md                    ← Agent Skill 标准
│
├── MemoryProxy/         API 代理层（TypeScript）
│   ├── src/
│   │   ├── anthropicHandler.ts     ← Anthropic /v1/messages handler（ANTHROPIC_BASE_URL 劫持）
│   │   ├── server.ts               ← HTTP 代理服务器
│   │   ├── handler.ts              ← 通用 handler
│   │   ├── auth.ts                 ← 认证
│   │   ├── tdai/                   ← TdaiClient（记忆写入/召回）
│   │   ├── skill/                  ← Skill 提取触发
│   │   ├── opik.ts                 ← Opik 可观测性
│   │   ├── clickhouse.ts           ← ClickHouse（可选）
│   │   └── redis-session-store.ts  ← Redis 会话存储（可选）
│   └── README.md
│
├── MemoryPanel/         前端控制面板
├── MemoryKnowledge/     知识管理模块（drizzle ORM）
├── sdk/                 SDK
└── deploy/              Docker 部署
```

**关键设计**：
- **TdaiCore 是 host-neutral facade**——只依赖 `HostAdapter` + `LLMRunner` 抽象接口，不绑定 OpenClaw
- 两种 HostAdapter：`OpenClawHostAdapter`（进程内）+ `StandaloneHostAdapter`（HTTP/gateway）
- **我们可以写自己的 `IeidevHostAdapter`** 来集成

### MemOS 架构

```
MemOS/
├── src/memos/            Python 服务端核心
│   ├── mem_os/
│   │   └── core.py                 ← MOSCore 总编排器
│   ├── mem_cube/                   ← MemCube（记忆立方体）
│   │   ├── general.py              ← GeneralMemCube
│   │   └── navie.py                ← NaiveMemCube
│   ├── mem_reader/                 ← 多模态记忆读取
│   ├── mem_scheduler/              ← 异步调度器（general/optimized）
│   ├── mem_feedback/               ← 反馈系统
│   ├── templates/                  ← LLM prompt 模板
│   │   ├── mem_reader_prompts.py
│   │   ├── mem_scheduler_prompts.py
│   │   └── mem_feedback_prompts.py
│   └── configs/                    ← 配置
│
├── apps/                 应用层
│   ├── memos-local-plugin/         ← TypeScript 本地插件（100% 端侧）
│   │   ├── core/
│   │   │   ├── memory/l1/          ← L1 轨迹存储
│   │   │   ├── memory/l2/          ← L2 策略归纳
│   │   │   ├── memory/l3/          ← L3 世界模型
│   │   │   ├── skill/              ← 技能结晶化
│   │   │   ├── reward/             ← 奖励系统
│   │   │   ├── feedback/           ← 反馈修正
│   │   │   ├── retrieval/          ← 三层检索 RRF+MMR
│   │   │   ├── capture/            ← 记忆采集
│   │   │   └── storage/            ← SQLite 存储
│   │   ├── adapters/               ← 适配器
│   │   │   ├── openclaw/           ← OpenClaw 适配
│   │   │   └── hermes/             ← Hermes 适配
│   │   └── agent-contract/         ← MemoryCore 接口
│   ├── memos-local-openclaw/       ← OpenClaw 集成
│   └── MemOS-Cloud-OpenClaw-Plugin/ ← 云端插件
│
├── deploy/               Docker 部署
└── examples/             示例代码
```

**关键设计**：
- **双轨架构**：Python 服务端（全功能，需 Neo4j+Qdrant）+ TypeScript 本地插件（轻量，SQLite）
- 本地插件是**100% 端侧、零云依赖**
- 适配器模式：adapters/openclaw + adapters/hermes

---

## 3. 记忆模型对比

### TencentDB：L0→L1→L2→L3 四层蒸馏

| 层 | 代码位置 | 职责 | 存储格式 |
|----|---------|------|---------|
| L0 原始对话 | `conversation/l0-recorder.ts` | 完整对话记录 | SQLite JSONL |
| L1 原子事实 | `prompts/l1-extraction.ts` + `l1-dedup.ts` | 从 L0 提取原子事实（persona/episodic/instruction 三类）+ priority 打分 | SQLite 结构化 |
| L2 场景知识 | `prompts/scene-extraction.ts` + `scene/` | 从 L1 归纳场景知识（LLM 用文件工具自主管理 scene_blocks/*.md） | SQLite + Markdown |
| L3 用户画像 | `prompts/persona-generation.ts` + `persona/` | 从 L2 生成用户画像（四层深度扫描 persona.md） | SQLite + Markdown |
| Skill | `skill/skill-extractor.ts` | 从对话和工具调用提取可复用工作流 | SQLite + 版本管理 |

**特点**：
- L2 用 LLM + 文件工具（read/write/edit）自主管理 `.md` 文件——**与文件基底理念兼容**
- 蒸馏是自动的（LLM 驱动），有触发调度（每 N 轮或空闲 T 秒）
- 有 checkpoint 机制（断点续蒸馏）

### MemOS：L1→L2→L3 三层演化 + Skills

| 层 | 代码位置 | 职责 | 存储格式 |
|----|---------|------|---------|
| L1 Traces | `core/memory/l1/` | 原始轨迹存储 + 多模态搜索 + 优先级 | SQLite |
| L2 Policies | `core/memory/l2/` | 跨任务策略归纳（signature 分桶 → LLM 归纳 → gain 评估） | SQLite |
| L3 World Models | `core/memory/l3/` | 跨任务世界模型抽象（Environment/Intent/Constraints） | SQLite |
| Skills | `core/skill/` | 从 L2 结晶化可调用技能（probationary→active→archived） | SQLite |
| Reward | `core/reward/` | R_human 评分（三轴）+ V_t 反向传播 + priority 衰减 | SQLite |
| Feedback | `core/feedback/` | 反馈分类 + 修正 + 决策修复 | SQLite |

**特点**：
- 有**奖励系统**（R_human → V_t 反向传播）——TencentDB 没有
- 有**反馈驱动修正**——TencentDB 没有
- L2 有 **gain 评估**（`weightedMean(with) − mean(without)`）——量化策略收益
- priority 衰减公式：`max(V,0) · 0.5^(dt/30)`——纯计算零依赖

### 模型对比

| 维度 | TencentDB L0-L3 | MemOS L1-L3 |
|------|----------------|-------------|
| 层次数 | 4（L0+L1+L2+L3） | 3+Skill+Reward+Feedback |
| 蒸馏方向 | L0→L1→L2→L3 单向 | L1→L2→L3 + 反馈回流 |
| 奖励系统 | ❌ 无 | ✅ R_human + V_t 反向传播 |
| 反馈修正 | ❌ 无 | ✅ 分类器+修正器+决策修复 |
| Skill 提取 | ✅ 已实现（skill-extractor） | ✅ 已实现（skill crystallization） |
| L2 管理 | LLM + 文件工具自主管理 .md | LLM + signature 分桶 + gain 评估 |
| L3 | 用户画像（persona） | 世界模型（Environment/Intent/Constraints） |
| 检索 | BM25 + 向量 + RRF | FTS5 + 向量 + 三层 RRF/MMR |
| 触发调度 | 每 N 轮 / 空闲 T 秒 / checkpoint | 事件驱动（reward.updated / l2.policy.induced） |

---

## 4. 存储与部署对比

| 维度 | TencentDB | MemOS |
|------|-----------|-------|
| 本地存储 | SQLite + sqlite-vec | 本地插件：SQLite + FTS5；服务端：Neo4j + Qdrant |
| 云存储 | TencentDB VectorDB（可迁移） | MemOS Cloud |
| 可选依赖 | ClickHouse / Redis / MongoDB / Kafka | Redis（调度器） |
| 向量搜索 | sqlite-vec（本地）+ TencentDB VectorDB（云） | 本地插件：本地嵌入；服务端：Qdrant |
| 全文搜索 | sqlite-vec BM25 | SQLite FTS5 |
| 纯文件后端 | ❌ 不可（强依赖 SQLite） | ❌ 不可（强依赖 SQLite） |
| Docker 部署 | ✅ `deploy/` 一键部署 | ✅ `deploy/` + `docker/` |
| 外部 LLM | OpenAI-compatible API（@ai-sdk/openai） | 6 个 LLM 提供商（含 local_only） |

---

## 5. Agent 集成对比

| 维度 | TencentDB | MemOS |
|------|-----------|-------|
| OpenClaw | ✅ 原生插件（openclaw.plugin.json） | ✅ 原生插件（memos-local-openclaw） |
| Hermes | ✅ 有安装脚本 | ✅ 有适配器（adapters/hermes） |
| Claude Code | MemoryProxy（ANTHROPIC_BASE_URL 劫持） | ❌ 无直接适配 |
| CodeBuddy | MemoryProxy（同上） | ❌ 无直接适配 |
| Host-neutral | ✅ TdaiCore facade（HostAdapter 接口） | ✅ agent-contract 接口 |
| 自定义适配 | 写 HostAdapter（4 个方法） | 写 adapter（类似） |
| MCP Server | ❌ 无 | ✅ 有（api/mcp_serve.py，服务端） |
| OTLP/OpenTelemetry | ✅ 有（@opentelemetry/* 依赖） | 未确认 |

---

## 6. 关键差异总结

| 维度 | TencentDB | MemOS | 对我们的意义 |
|------|-----------|-------|------------|
| **语言** | TypeScript | Python + TypeScript | 我们工作台如果 TS 优先，TencentDB 更亲和 |
| **记忆模型** | L0-L3 四层蒸馏 | L1-L3 三层 + 奖励 + 反馈 | MemOS 更完整（有奖励/反馈），TencentDB 更实用（L2 用文件工具） |
| **奖励系统** | ❌ | ✅ R_human + V_t | MemOS 的 priority 衰减公式可直接借鉴 |
| **反馈修正** | ❌ | ✅ | MemOS 的反馈机制可增强我们的 F-NNN |
| **L2 管理** | LLM + 文件工具自主管理 .md | LLM + signature 分桶 + gain | TencentDB 的 L2 与文件基底更兼容 |
| **Claude Code 集成** | ✅ MemoryProxy（API 劫持） | ❌ | TencentDB 有现成的 CC 集成路径 |
| **OTLP** | ✅ 原生 | 未确认 | TencentDB 与我们的 OTLP 统一事件源更对齐 |
| **Host-neutral** | ✅ TdaiCore（4 方法接口） | ✅ agent-contract | 两者都可自定义适配 |
| **Skill 提取** | ✅ 已实现 | ✅ 已实现 + 验证器 | MemOS 有更成熟的 skill 质量门 |
| **纯文件后端** | ❌ 强依赖 SQLite | ❌ 强依赖 SQLite | 两者都不能直接替换文件基底 |

---

## 7. 评估：能否替代或加强我们的记忆方案？

### 能否替代？

**❌ 都不能直接替代**——两者都强依赖 SQLite，与我们的文件基底不变式（markdown + JSONL，人类可读，git 可追踪，零依赖）冲突。

### 能否加强？

**✅ 两者都可作为增强层**，但方式不同：

#### 方案 A：TencentDB 增强（推荐）

**集成路径**：写 `EmployeeHostAdapter`（实现 TdaiCore 的 HostAdapter 接口 4 个方法）→ `new TdaiCore({hostAdapter, config})` → 用其 `handleBeforeRecall` / `handleTurnCommitted`

**优势**：
1. TypeScript 与工作台技术栈一致
2. MemoryProxy 已有 Claude Code 集成路径（ANTHROPIC_BASE_URL 劫持）
3. L2 用 LLM + 文件工具自主管理 .md——与文件基底理念兼容
4. 原生 OpenTelemetry/OTLP 支持——与我们的 OTLP 统一事件源对齐
5. Skill 提取已实现——可增强我们的 skill_store

**劣势**：
1. 无奖励系统（无 R_human / V_t 反向传播）
2. 无反馈驱动修正
3. SQLite 依赖（虽然 L2/L3 用 .md，但 L0/L1 和索引仍需 SQLite）

**借鉴点**（不引入 SDK，只移植设计）：
- L1 提取 prompt（persona/episodic/instruction 三类 + priority 打分）
- L2 场景提取（LLM 用文件工具自主管理 scene_blocks/*.md，UPDATE>MERGE>CREATE 策略）
- L3 画像生成（四层深度扫描 persona.md）
- 召回注入分离（prependContext 动态记忆 vs appendSystemContext 稳定 persona，prompt cache 命中）
- 触发调度参数（L1 每 5 轮 / 空闲 600s；L2 延迟 10s / 间隔 900-3600s；L3 每 50 条）

#### 方案 B：MemOS 增强

**集成路径**：本地插件 TypeScript 架构，可参考其 adapters/ 写自己的适配器

**优势**：
1. 奖励系统（R_human + V_t 反向传播 + priority 衰减）——TencentDB 没有
2. 反馈驱动修正——比我们的 F-NNN 更结构化
3. Skill 结晶化验证器（tool coverage + evidence resonance）——更成熟的质量门
4. L2 gain 评估（量化策略收益）——TencentDB 没有

**劣势**：
1. Python + TypeScript 双语言——与工作台 TS 技术栈不一致
2. 无 Claude Code 集成路径
3. OTLP 支持未确认
4. L2 用 SQLite 而非文件工具

**借鉴点**（不引入 SDK，只移植设计）：
- priority 衰减公式 `max(V,0)·0.5^(dt/30)`（纯计算零依赖）
- R_human 三轴评分 rubric（goal 0.45 + process 0.3 + satisfaction 0.25）
- gain 收缩基线（pseudocount=5）
- skill 结晶化验证器（tool coverage ≥50% + evidence resonance ≥50%）
- L2 signature 分桶键 `<primaryTag>|<secondaryTag>|<tool>|<errCode>`

### 推荐：方案 A 为主 + 方案 B 借鉴

```
MVP（L0/L1 不需要记忆）：
  └── 文件基底（markdown + JSONL，零依赖）

L2+ 增强（后续）：
  ├── TencentDB SDK 集成（写 EmployeeHostAdapter）
  │   ├── L0-L3 自动蒸馏（替代人工每日汇总）
  │   ├── Skill 提取（增强 skill_store）
  │   ├── 召回注入分离（prependContext vs appendSystemContext）
  │   ├── OTLP 原生支持
  │   └── MemoryProxy（CC 集成路径）
  │
  └── MemOS 设计借鉴（不引入 SDK）
      ├── priority 衰减公式 → Step frontmatter 派生字段
      ├── R_human 三轴评分 → Step 评分维度增强
      ├── gain 收缩基线 → Step self_eval_score 归一化
      ├── skill 验证器 → skill_store 质量门
      └── feedback 修正 → F-NNN 反馈落地追踪
```

**理由**：
1. TencentDB 与我们的技术栈（TS）、集成需求（CC）、观测需求（OTLP）更对齐
2. MemOS 的奖励/反馈设计更先进，但引入 Python 增加复杂度
3. 取两者之长：TencentDB 做增强层 + MemOS 做设计借鉴

---

## 8. 对白皮书 v0.7 的影响

1. §9 工程记忆：修正 TencentDB 描述（源码实证），采用"方案 A 为主 + 方案 B 借鉴"路线
2. §6 适配形态：补充 MemoryProxy（API 劫持）作为第四种适配形态
3. §4.3 OTLP：TencentDB 原生支持 OTLP，印证我们的 OTLP 统一事件源方向正确
4. 1.0 元素清理：移除所有 ieidev 前缀，改用通用名称

---

## 附录：纠错记录

本次调研经历了三轮反复，以下是纠错历史：

| 轮次 | 来源 | 说法 | 源码实证 |
|------|------|------|---------|
| 第 1 轮 | WebFetch GitHub | MemoryCore/MemoryProxy 等目录存在，四大资产已实现 | ✅ **正确**——目录和功能确实存在 |
| 第 2 轮 | research workflow agent | "目录不存在是幻觉""Skill 是 Roadmap""CodeGraph 不存在" | ❌ **错误**——这本身才是幻觉。MemoryCore/src/core/skill/ 有完整的 skill 实现 |
| 第 3 轮 | 源码直读 | 见本报告 | ✅ 源码级实证 |

**教训**：WebFetch 取 GitHub README 可能幻觉，research agent 也可能幻觉。**唯一可靠的方法是 clone 源码直接读文件**。