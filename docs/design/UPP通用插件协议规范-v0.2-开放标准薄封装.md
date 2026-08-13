# UPP 通用插件协议规范

## ——开放标准薄封装：一份员工包，多底座原生适配

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 开放标准薄封装版 |
| 日期 | 2026-08-10 |
| 状态 | 🟡 草案（替代 v0.1 自研中性协议路线，待评审） |
| 取代 | [UPP v0.1 草案](UPP通用插件协议规范-v0.1-草案.md)（自研中性协议路线，存档保留作 pivot 前 audit trail） |
| 依据 | [开放标准与 UPP 再审视调研报告](数字员工多底座适配调研报告-开放标准与UPP再审视-2026-08-10.md)（行业向开放标准收敛的实查）+ [白皮书 v0.4](数字员工套件2.0架构白皮书-v0.4-对标QoderWake多底座适配.md) §3.7 + 1.0 真实代码盘点 |
| 读者 | 工作台（运行层）开发者、底座 shim 作者、员工包作者 |

---

## §0 v0.1 → v0.2 的核心变化

v0.1 把"CC 风格 PascalCase 事件名"当作**自研的中性协议**。调研报告 §3.4 发现一个关键事实：**这些事件名已经是多家底座原生实现的事实跨底座标准**——VS Code Copilot、Qoder CN/Lingma、Docker、腾讯云（文档 1831 明说"完全兼容 Claude Code Hooks 规范"）都在原生跑同名同语义事件。同理 Agent Skills（SKILL.md，30+ 底座原生）、AGENTS.md（AAIF/Linux 基金会，6 万+ 项目）、MCP 也已是开放标准。

**结论：UPP 想做的事，行业正在把它标准化。继续自造一套中性协议 = 重复造轮子 + 与生态漂移。**

v0.2 的 pivot：

| | v0.1（自研中性协议） | v0.2（开放标准薄封装） |
|---|---|---|
| UPP 是什么 | 自定义 Agent/Hook/Skill/Command 中性 schema | **开放标准的打包/分发层** |
| 事件名 | "UPP 规范事件名"（自研命名层） | 即 CC Hooks 规范（事实跨底座标准） |
| manifest | 重描述每个 agent/hook/skill | 声明包内有哪些 open 标准文件 + 分发元数据 |
| 适配器职责 | 翻译自研协议 → 底座原生 | **判定底座对 open 标准的原生支持度 → 只补缺失 shim** |
| 适配器数量 | 8 个都要 | 少数薄 shim（仅不原生支持 open 标准的底座） |

**保留不变**（调研报告 §2 确认不推翻）：三支点 S1/S2/S3（引擎不依赖 hook / L0-L3 降级阶梯 / 运行面翻译已实证）、能力协商 + 可达 Level + 降级目录、CQO L-a 实时拦截边界、硬边界 B-1~B-6。

---

## §1 开放标准薄封装原理

关键区分：**文件格式在标准化，目录位置没有标准化。**

| 层 | 是否开放标准 | 说明 |
|----|------------|------|
| AGENTS.md 内容格式 | ✅ AAIF/Linux 基金会 | 项目级指令的跨底座标准（opencode/Codex/Cursor 原生读 root 的它） |
| SKILL.md 格式 | ✅ Agent Skills（agentskills.io，30+ 底座） | skills 的标准格式 |
| hooks.json 格式 | ✅ 事实标准（CC Hooks 规范，VS Code/Qoder CN/腾讯/Docker 原生） | 事件 schema 标准 |
| mcp.json 格式 | ✅ MCP（AAIF 成员） | 连接器标准 |
| **这些文件放哪个目录** | ❌ 碎片化 | `.claude/` / `.cursor/` / `.trae/` / `.pi/` / `.agents/` 各家各写 |

因此 v0.2 把**源布局与落地布局分开**：

- **员工包源 = 中立 canonical 布局**（不偏向任何底座），用 open 标准的**文件格式**
- **安装 = 每底座薄 shim 把 open-标准-格式的文件转/落位到该底座期望的位置**（纯文件落位 + 格式小差异适配，不碰协议）

格式零适配（标准一致）；shim 只管"放哪 + 转换"。

### 1.1 安装是必须的

**员工包必须安装到智能体底座，否则底座不知道"我是谁"。**

每个底座的 Agent 启动时，必须有一个身份源（CC 读 CLAUDE.md，CB 读 CODEBUDDY.md，opencode 读 AGENTS.md）。这是底座的原生加载机制，无法绕过。不安装只有两条路：

| 方案 | 做法 | 根本缺陷 |
|------|------|---------|
| CLI 注入 | 把 AGENTS.md 内容通过 CLI 参数注入 | 绕过了底座原生加载机制；MCP/hooks 连接器无法通过 CLI 参数注册 |
| API 注入 | MemoryProxy 层注入到 system prompt | 只能注入指令，管不了 MCP 工具注册和 hooks 拦截；底座不知道自己是员工 |

**安装 ≠ 运行时依赖**：安装后底座自己加载、自己运行，工作台不需要驻留在底座进程里。L0/L1 就是安装一次，底座就是员工，用户直接对话。

**UPP 四层适配的前三层（MCP + Hooks + AGENTS.md）依赖安装作为物理基础**——MemoryProxy 作为第四层只能注入记忆，不能替代前三层的工具注册和 hook 拦截。没有安装，四层适配缺了三层。

---

## §2 员工包源布局（中立 canonical）

```
ieidev-dev-engineer/
├── manifest.yml                    # 分发元数据 + open 标准文件清单（§5）
├── AGENTS.md                       # open 标准：项目级指令（唯一指令源，CC shim 转 CLAUDE.md）
├── skills/                         # open 标准：Agent Skills（每个 <name>/SKILL.md）
│   ├── ieidev-tdd-methodology/SKILL.md
│   └── ieidev-secure-coding/SKILL.md
├── hooks/hooks.json                # open 标准：CC Hooks 规范（事件 + matcher + command）
├── commands/                       # slash commands（flow-driver.md / goal.md / setup.md）
├── mcp.json                        # open 标准：MCP 连接器
├── orchestration/                  # 我们自己的（node-table，非 open 标准，引擎自读）
│   └── dev-engineer.node-table.yml
├── knowledge/                      # 员工专属知识库（文档随包分发，白皮书 §4.4）
└── tests/
```

**设计要点**：

1. **AGENTS.md 是唯一指令源**——不另写 CLAUDE.md。CC 读 CLAUDE.md，由 CC shim 安装时转换（§4）。单源、无重复，维护只改一份。
2. **`orchestration/` 不是 open 标准**——node-table 是我们的 SOP 资产，引擎（base-agnostic）自读，不经 shim 翻译。
3. **不继承 1.0 的 `.claude/` 形**——1.0 是 CC 插件所以长在 `.claude-plugin/` 里；2.0 员工包源中立，`.claude/` 是 CC shim 的落地目标，不绑架源布局。

---

## §3 开放标准文件格式

### 3.1 AGENTS.md（项目级指令）

- **标准**：AAIF/Linux 基金会，OpenAI 捐赠，Anthropic/Microsoft/Google/AWS 支持
- **我们怎么用**：员工的主 agent 身份指令（"我是谁/我的原则/我的能力"）写成 AGENTS.md。opencode/Codex/Cursor 等原生读 root 的它，零 shim。
- **CC 兜底**：CC 读 CLAUDE.md → CC shim 安装时把 AGENTS.md 转成 CLAUDE.md（§4）。前瞻：CC 若原生支持 AGENTS.md（Anthropic 是 AAIF 成员），此 shim 退化成 no-op。

### 3.2 SKILL.md（Agent Skills）

- **标准**：agentskills.io，YAML frontmatter（name/description）+ markdown 正文 + 渐进式披露三级加载，30+ 底座原生
- **我们怎么用**：1.0 已在写 SKILL.md，格式本就符合标准。原生支持它的底座（CC/CB/Qoder/opencode/Pi 等）零适配。

### 3.3 hooks.json（CC Hooks 规范）

- **标准**：事实跨底座标准——VS Code Copilot、Qoder CN/Lingma、Docker、腾讯云原生实现同名同语义事件（`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`SessionStart`/`SessionEnd`/`PreCompact`/`Stop`）
- **我们怎么用**：1.0 存量 `hooks/hooks.json` + Python hook 脚本按 CC 协议 stdin 喂送，**天然就是标准协议**。v0.1 把它再命名成"UPP 规范事件名"是多余的，v0.2 删除该框定。
- **关键**：越多底座原生实现 CC Hooks 规范，我们的 hook 资产零改动覆盖越广——这是方案 C 的生态红利。

### 3.4 mcp.json（MCP）

- **标准**：MCP（AAIF 成员），跨底座工具接入事实标准
- **我们怎么用**：白皮书 v0.4 manifest `connectors:` 声明的 MCP server，安装时落位到底座的 MCP 配置。

---

## §4 shim 架构（双平面）

### 4.1 安装面 shim（文件落位 + 转换）

每底座 shim 的职责 = 把包内 open-标准-格式的文件放进该底座期望的目录，必要时做格式转换。**一般模式：包放 canonical 源，shim 转/落位成底座期望形态。**

| 底座 | AGENTS.md | skills/ | hooks/ | mcp.json | shim 量 |
|------|-----------|---------|--------|----------|--------|
| Claude Code | **转 CLAUDE.md**（root） | `.claude/skills/` 或插件 skills/ | 插件 hooks.json | `.mcp.json` | 极轻（转换+落位） |
| CodeBuddy | 同 CC | 同 CC | 同 CC | 同 CC | 极轻（已验证） |
| Qoder (CN/Lingma) | 原生 | 原生 | **原生 CC Hooks** | 原生 | 近零（已验证） |
| opencode | **原生读 root** | `~/.claude/skills/`（CC 兼容） | TS 翻译层（已有，148 行实证） | 原生 | 轻 |
| TRAE | 内容→`.trae/agents/agent.md` | →`.traerules` | ✗（无事件模型） | `mcp.json/yaml` | 中 |
| Pi | ? | `.pi/extensions/`（resources_discover→SKILL.md） | ✗（自有 5 事件） | ? | 中 |
| Hermes | ✗（代码注册） | skill_bundles.py（非标准） | ✗ | rest/socket 桥 | 高（代码化） |
| OpenClaw | ? | `.agents/skills/` | ✗ | tool contract | 中高 |

> 图例：✅ 原生 · 转=shim 转换/落位 · ✗ 不支持 · ? 待真机验证（§8）

**CC shim 的 AGENTS.md→CLAUDE.md 转换**：若两者格式完全对齐则近 identity copy；若有 spec 分歧（AGENTS.md 特性 CC 不解析，或反之）shim 做最小适配。转换在安装时一次性完成，维护只改 AGENTS.md 源。

### 4.2 运行面 shim（事件/工具协议翻译）

安装面只解决"文件落位"；运行面解决"底座事件/工具协议 → 我们的 hook 脚本/引擎"。

- **原生支持 CC Hooks 的底座**（CC/CB/Qoder CN/VS Code/腾讯/Docker）：hook 脚本直接被底座按 CC 协议 stdin 喂送，**运行面零 shim**。
- **opencode**：`tool.execute.before` → 翻译成 CC `PreToolUse` 协议喂给同一个 Python hook 脚本（1.0 适配器 index.ts 148 行已实证）。工具名同步翻译（`bash`→`Bash`、camelCase→snake_case）。
- **无事件模型的底座**（TRAE/OpenClaw 等）：运行面无 shim 可做 → hook 驱动的能力（CQO L-a、记忆实时落盘）走降级路径（§7）。

**不变式**：hook 脚本/引擎代码永远只说 CC Hooks 规范协议，不感知底座。底座差异收敛在各 shim 的翻译层。

---

## §5 manifest v2 schema（薄的）

manifest 不再重描述每个 agent/hook/skill（那些由 open 标准文件自身描述，shim 直接读标准文件）。manifest 只管：分发元数据 + open 标准文件清单 + 能力需求声明。

```yaml
# manifest.yml —— UPP v2（开放标准薄封装）
upp_version: "2.0"
id: dev-engineer
display: 开发工程师
version: 1.2.0
engine_version: ">=1.2.0"          # 依赖的编排引擎版本（L2+ 用）

# ── 开放标准文件清单（包内即这些文件，格式均符合 open 标准，shim 直接读）──
standards:
  instruction: AGENTS.md            # AAIF 标准；CC shim 转 CLAUDE.md
  skills: skills/                   # Agent Skills 标准（SKILL.md）
  hooks: hooks/hooks.json           # CC Hooks 规范
  mcp: mcp.json                     # MCP 标准

# ── 我们自己的（非 open 标准，引擎自读，不经 shim 翻译）──
orchestration:
  node_table: orchestration/dev-engineer.node-table.yml
commands: commands/                 # slash commands（触发方式各底座不同，shim 适配）

# ── 能力需求（能力协商输入，见 §6）──
requires:
  level: L2                         # 设计运行级别（L0|L1|L2|L3）
  capabilities:                     # 达到设计级别所需的能力面
    - agent-def
    - skill-def
    - slash-command
    - bash-exec
    - fs-access
    - subagent-dispatch
optional:                           # 有这些更好，没有走降级
  - event:PreToolUse                # CC Hooks 规范事件 → CQO L-a
  - event:PostToolUse               # → CQO L-a / 记忆 commit-tracker
  - event:UserPromptSubmit          # → 记忆召回
  - event:SessionStart              # → 记忆 brief / HUD
  - event:SessionEnd                # → 记忆兜底
  - event:PreCompact                # → 记忆快照
  - event:Stop                      # → 记忆收尾
  - statusline                      # → HUD 状态栏
  - mcp                             # → 连接器

# ── 白皮书 v0.4 字段保留 ──
task_templates:
  - title: 处理缺陷并准备 PR
    prompt: 帮我处理 {仓库名} 中的 {缺陷编号}，完成代码改动并准备 PR
connectors:
  - name: github
    command: npx -y @modelcontextprotocol/server-github
    env: [GITHUB_TOKEN]
```

**比 v0.1 薄在哪**：v0.1 的 `agents:`/`hooks:`/`skills:` 数组把每个原语重描述一遍（与 open 标准文件内容重复）；v0.2 只指向 open 标准文件，shim 直接读标准文件——单一真相源在标准文件，不在 manifest。

---

## §6 能力协商（保留，判定基准改为 open 标准支持度）

### 6.1 底座能力档案（Base Capability Profile）

每底座 shim 随包声明该底座对 open 标准的原生支持度：

```yaml
# adapters/trae/capability-profile.yml
base: trae
base_version_tested: "x.y.z"        # 真机验证过的底座版本（R-12/B-3 风险对策）
open_standards:                     # 对 open 标准的原生支持度
  agents_md: convert                # native | convert(shim 转) | unsupported
  agent_skills: convert             # .traerules 需转（待验证是否兼容 SKILL.md）
  cc_hooks: unsupported             # 无事件模型
  mcp: native
provides:                           # 通用能力面（非 open 标准部分）
  - slash-command                   # skills.commands 字段
  - bash-exec
  - fs-access
  - model-tier
unsupported:
  - event:PreToolUse                # CC Hooks 不支持 → CQO L-a 降级
  - event:PostToolUse
  - statusline
  - subagent-dispatch               # 待真机验证
```

### 6.2 协商算法（安装时执行）

```
输入：员工 manifest 的 requires + 底座 capability-profile
输出：安装报告 = { 可达 Level, 降级项清单, 告警 }

1. 必需能力匹配：requires.capabilities ⊆ (provides ∪ open_standards 中的 native/convert)？
   - 否 → 不可安装（报告缺失能力，终止）
   - 是 → 继续
2. 可达 Level 推导：
   - L0 需 agent-def；L1 加 skill-def；L2 加 slash-command + bash-exec + fs-access + subagent-dispatch；L3 加 goal 命令
   - 取满足的最高 Level，与员工设计 Level 取较小者
3. open 标准落位计划：每条 open_standards=convert → 生成 shim 转换任务（如 AGENTS.md→CLAUDE.md）
4. 可选能力降级映射：optional 中缺失的 → 查降级目录（§7）→ 生成降级配置
5. 告警：blocking hook 若底座无该事件 → 显式 WARN（CQO L-a 失效通知，不许静默）
```

### 6.3 可达 Level 矩阵（基于开放标准支持度）

| 底座 | AGENTS.md | SKILL.md | CC Hooks | MCP | 可达 Level | CQO | shim 量 |
|------|-----------|----------|----------|-----|-----------|-----|--------|
| Claude Code | convert→CLAUDE.md | 原生 | **原生** | 原生 | **L3 全量** | L-a+L-b+熔断 | 极轻 |
| CodeBuddy | 同 CC | 原生 | 原生 | 原生 | **L3 全量** | 全量 | 极轻（已验证） |
| Qoder (CN/Lingma) | 原生 | 原生 | **原生** | 原生 | **L3 全量** | 全量 | 近零（已验证） |
| opencode | **原生** | 原生(CC兼容) | 翻译层(实证) | 原生 | **L3** | 全量 | 轻 |
| TRAE | convert | 待验证 | ✗ | 原生 | **L1 确定，L2 待验证** | L-b+熔断 | 中 |
| Pi | ? | 原生(resources_discover) | ✗(自有5事件) | ? | **L1，L2 待验证** | L-b+熔断 | 中 |
| Hermes | ✗(代码注册) | 非标准 | ✗ | 桥 | **L1** | L-b 可代码化 | 高 |
| OpenClaw | ? | convert(.agents/skills/) | ✗ | 原生 | **L0-L1** | 不适用 | 中高 |

> 待真机验证项见 §8。CQO L-a 实时拦截仍是唯一非标准化硬能力，只在原生支持 CC Hooks 的底座可用（CC/CB/Qoder CN/opencode），其余降级为 L-b + 熔断。

---

## §7 保留不变 + 新增边界

### 7.1 三支点（调研报告 §2 确认不推翻）

- **S1 引擎不依赖 hook**：flow-driver L2 循环只要命令触发 + Bash + 文件读写 + subagent 派发——几乎普世。吃 hook 的只有 CQO 与记忆外围，且有降级路径。
- **S2 L0-L3 天然降级阶梯**：每底座安装时算出可达 Level 即为能力协商输出。
- **S3 运行面翻译已实证**：opencode 适配器 148 行翻译层在跑。

### 7.2 降级目录（沿用 v0.1）

| 降级标签 | 失去的能力 | 降级行为 | 残余保障 |
|---------|-----------|---------|---------|
| `degraded-cqo` | CQO L-a 实时拦截/审计 | 安装报告 WARN + 底座卡片标注"CQO 降级" | L-b checkpoint 深审（编排层，不依赖 hook）+ circuit-breaker 熔断（引擎内） |
| `degraded-memory` | 记忆实时落盘 hook 链 | 节奏式：node-table 节点边界强制 step-recorder + slash 手动 + WARN 兜底文件（1.0 已有） | 记忆不丢，丢实时性 |
| `degraded-hud` | statusline | 呈现面切到工作台 Web（白皮书 §3.1） | HUD 数据来自 .ieidev/ 文件 |
| `degraded-mcp` | MCP 连接器 | 标记不可用，依赖的 skill 条件加载 | —— |
| `degraded-subagent` | subagent 派发 | L2 不可达 → 按 L1 交付 | 安装报告明示 |

### 7.3 硬边界

| # | 边界 | 对策 |
|---|------|------|
| B-1 | MCP shim 拦不住底座内建工具（Read/Write/Bash 不过 MCP） | CQO L-a 只靠底座自身事件模型，没有就降级，不做虚假拦截 |
| B-2 | 无动态注入的底座做不到"按提示词召回记忆" | 降级为会话级全量 brief + 节奏式落盘 |
| B-3 | 底座插件 API 随版本演进（调研基于 2026-08-10 快照） | 每适配器 `base_version_tested` + 能力探测 + 真机验证（§8） |
| B-4 | OpenClaw 不是编码宿主（个人助手形态） | 定位 L0-L1 分发渠道，不投入 L2 适配 |
| B-5 | Hermes 的 L2 要代码化重实现 | P2 后单独评估，不进 UPP v2 必达范围 |
| B-6 | subagent 语义差异（各底座上下文隔离/权限/返回格式不同） | UPP 派发契约 + shim 格式对齐；真机验证后补差异表 |
| **B-7（新）** | **依赖 open 标准成熟度**：Agent Skills 互操作深度尚浅、目录约定碎片化（.claude/.cursor/.trae/.pi）、CC Hooks 各底座实现细节可能有差异 | §8 真机盘点逐项验证；shim 不盲信"原生"，启动时能力探测 |

---

## §8 真机验证计划（v2 定稿前必做）

按优先级排序，每项产出验证报告并回写 §6.3 矩阵的 ?/convert 标记。**这正是适合用 workflow 并行跑的盘点**（八底座各一路验证 open 标准原生支持度）：

| # | 验证项 | 底座 | 方法 | 通过判据 |
|---|--------|------|------|---------|
| V-1 | AGENTS.md 原生读取 | opencode/Codex/Cursor/CC | 放 root AGENTS.md，看底座是否注入为指令 | 指令生效 |
| V-2 | CC Hooks 原生实现度 | VS Code/Docker/腾讯 | 放 hooks.json，触发 PreToolUse/PostToolUse | hook 脚本按 CC 协议被喂送 |
| V-2b | ✅ 已验证 | Qoder CN/Lingma | 已验证原生 CC Hooks | — |
| V-2c | ✅ 已验证 | CodeBuddy | 已验证兼容 CC hooks（基于 CC SDK） | — |
| V-3 | SKILL.md 兼容性 | TRAE/Pi/OpenClaw | 放标准 SKILL.md，看是否被发现/加载 | skill 可调用 |
| V-4 | AGENTS.md→CLAUDE.md 转换 | CC | shim 转换后 CC 读 CLAUDE.md | 指令生效，无格式损失 |
| V-5 | subagent 派发 | TRAE/Pi | 跑"主人设派能力 agent"最小用例 | 能力 agent 收到上下文并返回 |
| V-6 | flow-driver 最小循环 | TRAE/Pi | slash command 触发 2 节点 1 gate echo 版 node-table | flow-state.json 推进到 terminal |
| V-7 | 底座版本能力探测 | 全部 | 适配器启动探测底座版本 + 特性 | 版本不符时 WARN |

---

## §9 与既有文档的关系

| 文档 | 关系 |
|------|------|
| [开放标准与 UPP 再审视调研报告](数字员工多底座适配调研报告-开放标准与UPP再审视-2026-08-10.md) | 本规范的 pivot 依据（§3.4 CC Hooks 事实标准发现 + 方案 C 推荐） |
| [UPP v0.1 草案](UPP通用插件协议规范-v0.1-草案.md) | 本规范取代之；v0.1 的三支点/能力协商/降级目录/硬边界保留，自研中性协议层废弃 |
| [白皮书 v0.4](数字员工套件2.0架构白皮书-v0.4-对标QoderWake多底座适配.md) §3.7 | 本规范是其协议层展开；v0.4 §3.7 需回写引用 v0.2 |
| [UPP 可行性调研](多智能体底座插件系统调研-UPP可行性分析-2026-08-08.md) | 八底座插件体系实查，本规范 §6.3 矩阵的数据底座 |

---

*v0.2 回答"UPP 能否一对多真正适配"：能——但不是靠自造中性协议，而是靠**靠拢已成的开放标准**（AGENTS.md / Agent Skills / CC Hooks / MCP）。文件格式零适配（标准一致），shim 只管"放哪 + 转换"；越多底座原生实现这些标准，我们的适配器越薄。CQO L-a 实时拦截仍是唯一非标准化硬能力，按底座事件模型有无降级。*
