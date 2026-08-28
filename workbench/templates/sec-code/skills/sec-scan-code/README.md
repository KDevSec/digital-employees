# sec-scan-code

多语言安全代码扫描器，基于 OWASP Top 10:2025 规则体系，支持宪法优先级系统和 MCP 部署。

## 概述

sec-scan-code 是一个面向代码安全审计的扫描工具，可作为 **Claude Code Skill**、**Trae Skill**、**CodeBuddy Skill** 和 **MCP Server** 使用。它采用规则分离架构，将漏洞的"是什么"（OWASP 元数据）与"怎么查"（语言特定模式）解耦，在扫描时动态合并，实现对 Python、JavaScript、Go、Java、C 五种语言的精准安全扫描。

同时提供 AI 代码生成安全规则，支持 Claude Code、Trae 和 CodeBuddy 在生成代码时自动遵守安全编码规范。

### 重要: 下载技能包之后，对于包内的.codebuddy和.trae中的规则文件，可以复制到codebuddy或trae对应的规则文件目录中；对于其他技能文件，claude code和codebuddy可以复制到skill目录中直接使用，trae需要在IDE的配置中导入skill zip文件才能通过 /sec-scan-code 命令使用。复制之后，将skill目录中的.venv 压缩包解压到当前文件夹中，AgentHub平台由于文件数量限制，只能压缩之后上传。



## 核心特性

- **多语言支持** — Python、JavaScript、Go、Java、C + 配置文件（`.yml/.yaml/.properties/.env`）
- **引擎优先架构** — 确定性穷尽扫描由引擎完成，LLM 只做语义验证/补修复字段（不再逐行套正则）
- **OWASP Top 10 (2025)** — 完整覆盖 OWASP Top 10 漏洞类别
- **补充规则** — CSRF、XSS、路径穿越、不安全反序列化、竞态条件、供应链攻击、配置硬编码凭据
- **宪法优先级系统** — 双层宪法文件驱动扫描优先级
- **三种扫描模式** — 增量扫描（默认）、全量扫描、快速扫描
- **并行扫描** — 大项目自动多进程按文件并行（`--workers`）
- **风险打分 + 送审分层** — 候选按严重度×置信度×污点信号打分，`--top-k`/`--per-category` 控制送审集
- **每次扫描独立目录** — `.sec-scan-code/scans/<时间戳>/`，交付件与中间产物分离
- **大数据分析** — 历史扫描趋势分析，自动更新项目宪法（写入项目目录，无跨项目污染）
- **多格式报告** — JSON、HTML
- **MCP 部署** — 作为 MCP Server 暴露 6 个工具供外部调用（扫描入口，报告走 CLI）
- **只读安全** — 扫描器不修改任何源代码，仅产出发现和建议
- **AI 安全规则** — Trae/CodeBuddy 代码生成时自动遵守安全规范

## 架构

### 规则分离架构

```
OWASP YAML (查什么)  ×  Language YAML (怎么查)  →  完整扫描规则
─────────────────────────  ─────────────────────────  ──────────────
rule_id: A03-INJECTION    language: python           A03 × python
categories: [sql-injection, rules:                    → sql-injection: [...]
  command-injection, ...]   - category: sql-injection   command-injection: [...]
                            owasp: A03
                            patterns: [...]
```

### 宪法优先级系统

| 优先级 | 宪法文件                               | 说明                             |
| --- | ---------------------------------- | ------------------------------ |
| 最高  | 宪法文件2（`constitution-project.yaml`） | 项目特定规则，由 `--analyze` 大数据分析自动生成 |
| 高   | 宪法文件1（`constitution-owasp.yaml`）   | OWASP Top 10 规则，始终加载           |
| 普通  | 补充规则（`rules/supplementary/`）       | `--full` 时或显式请求时加载             |

### 扫描流程

```
Phase P: Python 环境检测（PYTHON_CMD，优先 skill 自带 .venv）
    ↓
Phase 0: 确定扫描范围（增量/全量/指定文件）
    ↓
Phase 1: 语言检测（指示文件 + 扩展名，排除依赖目录）
    ↓
Phase 2: 规则加载（rules-brief 精简摘要，不读全量 YAML）
    ↓
Phase 3: 扫描计划确认（AskUserQuestion 用户批准）
    ↓
Phase 4: 引擎穷尽扫描（cli.py scan，并行 + 风险打分 + 送审分层）
    ↓
Phase 5: LLM 逐条语义验证 + 补修复字段（候选多时用户选分析范围）
    ↓
Phase 6: 报告生成（cli.py report --finalize，只留交付件）
    ↓
Phase 7: 大数据分析（可选，更新项目宪法，写入项目 .sec-scan-code/）
```

**核心设计**：穷尽规则检查由确定性引擎完成（保证覆盖完整、上下文有界），LLM 只做判断性工作（语义验证、剔除误报、生成代码级修复建议）。这是与传统"LLM 逐行套正则"的本质区别。

## 项目结构

```
sec-scan-code/
├── SKILL.md                          # Claude Code Skill 定义文件
├── README.md                         # 本文档
├── pyproject.toml                    # Python 项目配置
├── bin/
│   ├── _skill_util.py                # 共享工具：解析 skill 目录 + sys.path
│   ├── detect-changes.py             # git 变更检测脚本（增量扫描范围）
│   ├── detect-languages.py           # 语言检测脚本
│   ├── generate-constitution-brief.py # 宪法摘要生成脚本
│   ├── hook-auto-scan.py             # PostToolUse 钩子（自动扫描）
│   └── hook-inject-constitution.py   # UserPromptSubmit 钩子（注入宪法）
├── secscancode/
│   ├── __init__.py
│   ├── cli.py                        # 引擎 CLI（scan/rules-brief/report/select）
│   ├── server.py                     # MCP Server（6 个工具）
│   ├── scanner.py                    # 扫描引擎（并行 + 风险打分）
│   ├── rules_loader.py               # 规则加载与合并
│   ├── git_changes.py                # git 变更检测（detect-changes 逻辑）
│   ├── analyzer.py                   # 大数据趋势分析
│   └── reporter.py                   # 多格式报告生成
├── rules/
│   ├── constitution-owasp.yaml       # 宪法文件1：OWASP Top 10
│   ├── constitution-project.yaml     # 宪法文件2：项目特定规则
│   ├── owasp/                        # OWASP 漏洞元数据（A01-A10）
│   ├── supplementary/                # 补充规则（CSRF/XSS/路径穿越/供应链/配置凭据等）
│   ├── languages/                    # 语言特定模式
│   │   ├── python.yaml
│   │   ├── javascript.yaml
│   │   ├── go.yaml
│   │   ├── java.yaml
│   │   ├── c.yaml
│   │   └── config.yaml               # 配置文件硬编码凭据检测
│   └── docs/                         # 漏洞说明文档
├── install.sh                        # 安装脚本（macOS/Linux，创建 skill .venv）
└── install.ps1                       # 安装脚本（Windows）
```

***

## 使用方式

### 一、Claude Code Skill

在 Claude Code 中直接使用斜杠命令：

| 命令                                      | 说明                                     |
| --------------------------------------- | -------------------------------------- |
| `/sec-scan-code`                        | 增量扫描（默认，仅扫描当前会话变更）                    |
| `/sec-scan-code --full`                 | 全量扫描（扫描项目所有源文件）                       |
| `/sec-scan-code --quick`                | 快速扫描（仅宪法规则检查变更文件）                     |
| `/sec-scan-code --lang python`          | 仅扫描指定语言                              |
| `/sec-scan-code --owasp`                | 仅扫描 OWASP Top 10 规则                   |
| `/sec-scan-code --files a.py,b.go`      | 扫描指定文件                               |
| `/sec-scan-code --top-k 100`            | 送审候选上限（默认 0 = 全部；>0 按风险分取前 N）          |
| `/sec-scan-code --per-category 20`      | 每类别硬限额（防噪声规则占满送审预算，默认 0 = 不限额）        |
| `/sec-scan-code --workers 8`            | 并行扫描进程数（默认 0 = 自动）                   |
| `/sec-scan-code --analyze`              | 大数据分析（更新项目宪法，写入项目 .sec-scan-code/）      |
| `/sec-scan-code --formats json,html`    | 指定输出格式（默认 html,json）                  |

**扫描产物**：每次扫描在 `.sec-scan-code/scans/<时间戳>/` 下建独立目录，`report --finalize` 后只保留交付件（HTML/JSON 报告 + scan-files.list 覆盖清单）。

#### 安装方法

使用安装脚本（推荐）：

```bash
# macOS / Linux
bash install.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File install.ps1
```

安装脚本会交互式引导你选择：

1. **目标智能体**：Claude Code / Trae / CodeBuddy
2. **安装级别**：用户级（全局可用）/ 项目级（仅当前项目）

脚本会自动将文件复制到正确目录并替换路径占位符。

也可以通过命令行参数直接指定：

```bash
# macOS / Linux
bash install.sh --agent claude-code --level user

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File install.ps1 -Agent trae -Level project -ProjectPath C:\my-project
```

配置hook，进行AI代码生成时规则检查，在setting.json中添加以下内容：

```json
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python ~/.claude/skills/sec-scan-code/bin/hook-inject-constitution.py",
            "timeout": 10
          }
        ]
      }
    ]
  },
```

参数说明：

| 参数               | 说明             | 可选值                                |
| ---------------- | -------------- | ---------------------------------- |
| `--agent`        | 目标智能体          | `claude-code`, `trae`, `codebuddy` |
| `--level`        | 安装级别           | `user`（用户级）, `project`（项目级）        |
| `--project-path` | 项目路径（项目级时）     | 默认当前目录                             |
| `--skip-deps`    | 跳过 Python 依赖安装 | -                                  |
| `-y` / `--yes`   | 非交互模式（自动确认）    | -                                  |

***

### 二、Trae Skill

使用安装脚本（推荐）：

```bash
bash install.sh --agent trae --level user    # 用户级
bash install.sh --agent trae --level project # 项目级
```

安装完成后：

- **sec-scan-code 技能**安装到 `~/.trae/skills/sec-scan-code/`（用户级）或 `.trae/skills/sec-scan-code/`（项目级）
- 在对话中输入 `/sec-scan-code` 即可使用
- **AI 安全规则**需要单独安装（见下方「AI 安全规则」部分）

***

### 三、CodeBuddy Skill

使用安装脚本（推荐）：

```bash
bash install.sh --agent codebuddy --level user    # 用户级
bash install.sh --agent codebuddy --level project # 项目级
```

安装完成后：

- **sec-scan-code 技能**安装到 `~/.codebuddy/skills/sec-scan-code/`（用户级）或 `.codebuddy/skills/sec-scan-code/`（项目级）
- 在对话中输入 `/sec-scan-code` 即可使用
- **AI 安全规则**需要单独安装（见下方「AI 安全规则」部分）

***

### 四、AI 安全规则（独立安装）

AI 安全规则让 Trae/CodeBuddy 在生成代码时自动遵守安全编码规范，独立于扫描技能打包和安装。

| 平台        | 规则目录                                                 | 文件格式   |
| --------- | ---------------------------------------------------- | ------ |
| Trae      | `~/.trae/rules/`（用户级）或 `.trae/rules/`（项目级）           | `.md`  |
| CodeBuddy | `~/.codebuddy/rules/`（用户级）或 `.codebuddy/rules/`（项目级） | `.mdc` |

安装方式：将对应的规则包解压到规则目录即可。

规则覆盖范围：

| 规则文件                | 激活条件                             | 覆盖漏洞类型                                               |
| ------------------- | -------------------------------- | ---------------------------------------------------- |
| security-general    | 所有文件                             | 输入验证、凭据管理、认证授权、错误处理、CORS、加密、日志、随机数、重定向、文件上传、HTTP头    |
| security-python     | `*.py`, `*.pyw`                  | SQL注入、命令注入、模板注入、eval/exec、反序列化、SSRF、Django专项、文件操作、限流 |
| security-javascript | `*.js`, `*.ts`, `*.jsx`, `*.tsx` | DOM XSS、原型污染、eval、正则DoS、Node.js专项                    |
| security-go         | `*.go`                           | SQL注入、命令注入、路径穿越、SSRF、并发安全                            |
| security-java       | `*.java`, `*.kt`                 | SQL注入、XXE、反序列化、Spring Security、路径穿越                  |
| security-c          | `*.c`, `.h`, `.cpp`              | 缓冲区溢出、格式化字符串、整数溢出、内存管理                               |

***

### 五、MCP Server

安装脚本会自动处理路径。如需手动配置 MCP Server，在智能体配置目录的 `settings.json` 中添加：

```json
{
  "mcpServers": {
    "sec-scan-code": {
      "command": "python",
      "args": ["-m", "secscancode.server"],
      "cwd": "<SKILL_DIR>"
    }
  }
}
```

将 `<SKILL_DIR>` 替换为实际的 skill 安装路径。若使用 skill 自带 `.venv`（install.sh 创建），
`command` 改为 `<SKILL_DIR>/.venv/bin/python`（Windows 为 `<SKILL_DIR>/.venv/Scripts/python.exe`）。

MCP 工具列表：

| 工具名                               | 说明            |
| --------------------------------- | ------------- |
| `sec_scan_incremental`            | 增量扫描          |
| `sec_scan_full`                   | 全量项目扫描        |
| `sec_scan_quick`                  | 快速宪法扫描        |
| `sec_scan_analyze`                | 大数据分析与宪法更新    |
| `sec_scan_list_rules`             | 列出可用规则        |
| `sec_scan_get_constitution_brief` | 获取宪法摘要用于上下文注入 |

> MCP 扫描工具只负责扫描并返回发现（与 CLI 的 scan 阶段一致）；生成含修复建议的
> 最终报告需在补全 `vuln_code`/`fix_code`/`exploit_scenario` 后通过 CLI `report` 命令完成。

***

## 扫描结果示例

```
SEC-SCAN RESULTS
════════════════
Mode:        incremental
Files:       3 scanned, 450 lines
Languages:   python, javascript

FINDINGS (sorted: severity desc, category asc)
════════
#  Sev      Category              File:Line
1  CRIT     command-injection     app/models/user.py:42
2  CRIT     sql-injection         app/models/user.py:38
3  HIGH     hardcoded-secret      config/settings.py:15
4  HIGH     xss-reflected         src/api/handler.js:18
5  MEDIUM   cors-wildcard         app/main.py:15

TOTALS: 2 CRITICAL, 2 HIGH, 1 MEDIUM

⚠ AI扫描不完善风险：可能遗漏复杂漏洞链、跨文件数据流漏洞、
  运行时才触发的漏洞。建议结合专业安全审计工具使用。
```

***

## 漏洞覆盖

### OWASP Top 10 (2025)

| ID  | 漏洞类别           | 严重度      |
| --- | -------------- | -------- |
| A01 | 权限控制失效（含 SSRF） | CRITICAL |
| A02 | 安全配置错误         | HIGH     |
| A03 | 供应链失败          | HIGH     |
| A04 | 加密失败           | HIGH     |
| A05 | 注入攻击           | CRITICAL |
| A06 | 不安全设计          | HIGH     |
| A07 | 认证失败           | CRITICAL |
| A08 | 软件和数据完整性失败     | HIGH     |
| A09 | 日志监控失败         | MEDIUM   |
| A10 | 异常处理不当（新增）     | HIGH     |

### 补充规则

- CSRF — 跨站请求伪造
- XSS — 跨站脚本攻击
- 路径穿越
- 不安全反序列化
- 竞态条件
- 供应链攻击 — 隐藏网络请求、反向 Shell、加密劫持、时间炸弹（constitutional，quick 模式也扫）
- 配置硬编码凭据 — `.yml/.yaml/.properties/.env` 中的密码/密钥/token/API key（CONFIG-SECRETS）

***

## 依赖

- Python >= 3.10
- mcp >= 1.0.0
- PyYAML >= 6.0
- Jinja2 >= 3.1

***

## 重要规则

- **引擎优先** — 穷尽规则检查由确定性引擎完成，LLM 只做语义验证/补修复字段，不逐行套正则
- **默认增量扫描** — 全量扫描开销大，需显式指定 `--full`
- **全部分析优先** — 候选默认全部进 findings.json；数量过大时让用户选择分析范围，不静默丢弃
- **语言感知** — 仅加载检测到语言的规则（配置文件规则恒加载）
- **宪法优先** — OWASP + 项目特定规则始终优先检查
- **只读操作** — 不修改源代码，仅产出发现和建议
- **注释/字符串过滤** — 注释、文档字符串、纯字符串行的匹配不产生发现
- **AI 局限性声明** — 结果中始终包含 AI 扫描局限性提示

***

## 许可证

MIT License
