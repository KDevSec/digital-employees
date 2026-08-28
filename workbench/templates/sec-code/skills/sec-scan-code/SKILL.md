---
name: "sec-scan-code"
description: "对源代码进行安全扫描审计，基于OWASP Top 10:2025规则和多语言检测模式，支持增量/全量/快速扫描，输出含修复建议的HTML/JSON报告。当用户要求对源代码做安全扫描/安全审计/代码安全检查/漏洞扫描时触发。注意：本技能仅针对源代码，不适用于设计文档安全审核（设计文档请使用sec-scan-design）。"
---

# /sec-scan-code — 源代码安全扫描器

多语言源代码安全扫描器，内置 OWASP Top 10:2025 规则、宪法优先级体系，并支持 MCP 部署。

## ⚠️ 强制执行要求（MANDATORY）

当此技能被调用时，你 **MUST** 严格按照下方「扫描流程」中定义的 Phase 0-7 逐步执行，不得跳过任何阶段。

### 逐 Phase 检查清单

**在开始任何扫描操作之前，你 MUST 逐条声明以下清单状态（全部 □ → ✅ 后才可开始扫描）：**

| 状态 | Phase | 要求 | 禁止 |
|:----:|-------|------|------|
| □ | P 平台检测 | 检测可用 Python 命令，确定 `PYTHON_CMD` | 禁止跳过，禁止假设 Python 命令 |
| □ | 0 扫描范围 | 用 `detect-changes` 脚本或 Glob 收集文件 | 禁止自己猜测文件列表 |
| □ | 1 语言检测 | 执行 `detect-languages.py` 脚本 | 禁止跳过语言检测 |
| □ | 2 规则加载 | 调 `cli.py rules-brief` 获取精简规则摘要 | 禁止逐文件 Read 全量规则 YAML（约 100K tokens 会撑爆上下文） |
| □ | 3 任务确认 | 用 AskUserQuestion 获得用户明确批准 | 禁止未经确认直接扫描 |
| □ | 4 扫描执行 | 调 `cli.py scan` 让引擎确定性穷尽扫描 | 禁止自己逐行套正则，禁止跳过引擎 |
| □ | 5 验证修复 | 逐条 Read 验证 + AI 语义验证去误报 + 生成代码级修复建议(含原代码/修复后代码) | 禁止跳过验证，禁止跳过语义验证，禁止给通用建议，禁止缺失原漏洞代码/修复后代码 |
| □ | 6 报告生成 | 用 `cli.py report` 从 findings.json 生成，Read 验证非空 | 禁止跳过报告持久化 |

**每完成一个 Phase，MUST 在输出中显式声明 "✅ Phase X 完成"，否则视为未完成。**

### 绝对禁止事项

- ❌ **禁止**跳过引擎，自己逐行套正则或用 grep/搜索工具扫描源码——穷尽扫描由引擎（`cli.py scan`）确定性完成，保证规则全覆盖
- ❌ **禁止**跳过规则加载直接凭经验判断漏洞——规则由引擎加载执行，智能体通过 `rules-brief` 摘要理解规则（不再逐文件 Read 全量 YAML）
- ❌ **禁止**跳过结果持久化步骤（必须写入每次扫描目录 `<scan_dir>` = `.sec-scan-code/scans/<时间戳>/`）
- ❌ **禁止**手写 Python 脚本拼装 ScanResult 生成报告（如 generate_report_full.py / finalize_report.py 等）——报告生成逻辑在 `reporter.py`，Phase 6 用 `cli.py report` 从 findings.json 生成
- ❌ **禁止**手写非标准 JSON 报告（如用 `report_metadata` 包裹结构、findings 用 `rule`/`title` 等非标准字段名）。报告 MUST 由 `generate_report()` 产出，Gate 6 会用 `validate_report_schema()` 校验，非标准报告会被拒绝
- ❌ **禁止**生成缺少原漏洞代码(vuln_code)/修复后代码(fix_code)/攻击场景(exploit_scenario)的报告——`generate_report()` 会强制校验并拒绝不合规报告
- ❌ **禁止**自行编造扫描结果——所有候选 MUST 来自引擎输出，智能体只做语义验证/剔除误报/补修复字段
- ❌ **禁止**把引擎当成黑盒"运行完即信任"——引擎产出的是**候选**，仍必须经过 Phase 5 语义验证与修复字段补齐后才可报告

## 参数说明

- `/sec-scan-code` — 增量扫描（默认）：仅扫描当前会话改动
- `/sec-scan-code --full` — 全量扫描：扫描项目全部源文件
- `/sec-scan-code --quick` — 快速扫描：仅对改动文件应用宪法规则
- `/sec-scan-code --lang python` — 仅扫描指定语言
- `/sec-scan-code --owasp` — 仅扫描 OWASP Top 10 规则
- `/sec-scan-code --files a.py,b.go` — 扫描指定文件
- `/sec-scan-code --analyze` — 大数据分析：更新项目宪法
- `/sec-scan-code --top-k 100` — 送审候选上限（默认 0 = 全部进深度验证；>0 时按风险分取前 N，可用 `--per-category` 每类别限额）
- `/sec-scan-code --workers 8` — 并行扫描进程数（默认 0 = 自动；≥30 文件时用 min(cpu,8)）
- `/sec-scan-code --formats json,html` — 输出格式。默认：html,json。支持：json, html

---

## Phase P：Python 环境检测（强制首步）

必须在任何其他 Phase 之前执行。检测可用的 Python 命令并设置 `PYTHON_CMD`，
供后续所有 Phase 调用 `bin/*.py` 脚本使用。**所有脚本已统一为 Python**，
不再按操作系统在 `.sh` / `.ps1` 之间分支。

### 检测方法

使用 RunCommand 工具执行，**优先 skill 自带的 `.venv`**（Python 依赖只装在
`{{SKILL_DIR}}/.venv`，由 install.sh Step 8 创建；扫描统一用该 venv 的 python），
无 venv 时回退系统 python：

```bash
if [ -x "{{SKILL_DIR}}/.venv/bin/python" ]; then PYTHON_CMD="{{SKILL_DIR}}/.venv/bin/python"
elif [ -x "{{SKILL_DIR}}/.venv/Scripts/python.exe" ]; then PYTHON_CMD="{{SKILL_DIR}}/.venv/Scripts/python.exe"
elif python --version >/dev/null 2>&1; then PYTHON_CMD="python"
elif python3 --version >/dev/null 2>&1; then PYTHON_CMD="python3"
elif py -3 --version >/dev/null 2>&1; then PYTHON_CMD="py -3"
else echo "ERROR: no working python found (run install.sh to create skill .venv)" >&2; fi
```

> 若回退到系统 python（无 skill `.venv`），依赖可能未安装，建议先运行 install.sh。

### 在后续 Phase 中使用

所有脚本调用 MUST 使用检测到的 `PYTHON_CMD`：

```
$PYTHON_CMD {{SKILL_DIR}}/bin/SCRIPT_NAME.py [args]
```

（Windows PowerShell 中等价：`& $PYTHON_CMD {{SKILL_DIR}}/bin/SCRIPT_NAME.py [args]`）

agent MUST 在整个会话中保存检测到的 `PYTHON_CMD`，并在 Phase 0、Phase 1 及其他脚本调用中一致使用。

**Phase Gate P**：MUST 验证 `PYTHON_CMD` 可用（能输出版本号）。若检测失败，请用户指定 Python 3 路径。

---

## Phase 0：确定扫描范围

必须根据模式标志执行相应的范围确定逻辑。

### 增量扫描（默认）

运行 `detect-changes.py` 脚本（使用 Phase P 检测到的 `PYTHON_CMD`）来检测改动文件：

```bash
# 所有平台统一（用 Phase P 检测到的 PYTHON_CMD）
$PYTHON_CMD {{SKILL_DIR}}/bin/detect-changes.py PROJECT_PATH
# 排除未跟踪（新增）文件：
$PYTHON_CMD {{SKILL_DIR}}/bin/detect-changes.py PROJECT_PATH --tracked-only
```

MUST 使用 RunCommand 工具执行。该脚本：
- 在任何操作前验证 git 仓库
- 收集：未暂存、已暂存、重命名、合并冲突、未推送、未跟踪（新增）文件
- 去重并过滤已删除文件（已不在磁盘上）
- 每行一个相对路径输出到 stdout
- 摘要输出到 stderr
- 退出码 0 = 有改动，1 = 无改动
- 使用 `--tracked-only` 排除未跟踪文件

**若 RunCommand 输出被清除/不可用**，MUST 重新执行脚本确认结果。MUST NOT 在无已验证输出的情况下假设"无改动"。

若未检测到 git 改动（退出码 1），告知用户使用 `--full` 或 `--files`。MUST NOT 猜测或编造文件列表。

### 全量扫描（`--full`）

文件收集由引擎在 Phase 4 完成：`cli.py scan --mode full` 内部的 `scan_full()`
会 os.walk 并按规则 `file_extensions` 收集源码（自动排除 `.git/`、`node_modules/`、
`__pycache__/`、`.venv/`、`dist/`、`build/` 等目录）。**Phase 0 无需手工收集文件**，
只需确认项目根目录存在。

**Phase Gate 0**：MUST 验证找到至少 1 个源文件。引擎扫描后依据
`<scan_dir>/scan-files.list`（`cli.py scan` 自动落盘）核对，若 0 个文件，停止并告知用户。

**⚠️ 落盘扫描文件清单（关键，不可跳过）**：扫描范围 MUST 落盘到
`<scan_dir>/scan-files.list`（纯文本，一行一个相对路径；未扫描文件以
`# SKIPPED: <原因>` 标注）。用户可随时打开此文件核对扫描的文件范围是否完整。

落盘方式（按模式）：
- **引擎扫描（全量/增量/快速）**：`cli.py scan` 会自动把扫描到的文件写入 `<scan_dir>/scan-files.list`，无需手工维护
- **增量（引擎前的范围确认）**：`$PYTHON_CMD {{SKILL_DIR}}/bin/detect-changes.py PROJECT_PATH` 输出改动文件，用于 Phase 3 确认范围
- **自定义**：把 `--files` 参数的文件列表写入 `scan-files.list`

> 每次扫描目录 `<scan_dir>` = `.sec-scan-code/scans/<时间戳>/`，由 `cli.py scan` 自动创建。

### 快速扫描（`--quick`）

文件收集方式同增量扫描。仅应用宪法规则（在 Phase 2 处理）。

### 自定义（`--files`）

使用显式提供的文件路径。MUST 在扫描前用 Glob 验证每个文件存在。

---

## Phase 1：语言检测

MUST 检测项目语言。即使语言看起来很明显，也不要跳过此阶段。

### 检测方法

使用 Phase P 检测到的 `PYTHON_CMD` 运行：

```bash
$PYTHON_CMD {{SKILL_DIR}}/bin/detect-languages.py PROJECT_PATH
```

该脚本复用引擎的 `detect_project_languages()`（两阶段检测：先看指示文件
`requirements.txt`/`go.mod`/`package.json` 等，再用文件扩展名扫描兜底；
自动排除 `node_modules/`、`.venv/` 等依赖目录）。

MUST 记录检测到的语言，供 Phase 2 和 Phase 4 使用。

**多语言自检（强制）**：Phase 1 得到检测结果后，MUST 用 Glob/`find` 统计项目中各源码扩展名（.java/.js/.ts/.vue/.go/.py 等）的文件数。若存在某扩展名有文件、但其对应语言未被检测到（例如有 .js/.vue 文件但 javascript 未被识别），MUST 主动将该语言补入检测结果并继续 Phase 2，不得仅凭脚本输出跳过。这是不依赖脚本的执行层保险——即使脚本漏检，agent 也能主动发现并补扫。

**Phase Gate 1**：MUST 验证检测到至少 1 种语言。若 0 种语言，请用户指定 `--lang`。

---

## Phase 2：规则加载

**关键**：此阶段 MUST 在 Phase 3 之前完全完成。
规则由引擎负责加载与执行。智能体**只加载精简摘要**（约 2-4K tokens），
**不再逐文件 Read 全量规则 YAML**——5 个语言规则文件合计约 100K tokens，全量读取会
撑爆 128K 上下文。

### 步骤 1：获取规则摘要（rules-brief）

执行以下命令获取规则摘要（JSON：rule_id / severity / priority / categories / pattern 数）：

```bash
# Linux/macOS/Git Bash（PLATFORM != windows-powershell）
# 不传 --lang 输出全部已装语言规则；如需按 Phase 1 检测结果限定，加 --lang <lang1> <lang2>
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['rules-brief']))"

# 若 secscancode 已 pip 安装，也可直接用控制台入口：
sec-scan-engine rules-brief
```

摘要关键字段：
- `rule_count`：加载的规则总数
- `pattern_total`：总检测模式数
- 每条规则的 `rule_id`, `name`, `severity`, `priority`, `categories`（类别 → pattern 数）

### 步骤 2：按需读取规则详情

摘要用于理解规则覆盖范围。**只有遇到具体疑似点时**，才按需 Read **单个 category** 的
语言 YAML 段落（例如验证某个 sql-injection 候选时，Read `{{SKILL_DIR}}/rules/languages/python.yaml`
中 sql-injection 段落附近的 patterns/taint_sinks），**不要整文件读取**。

### 步骤 3：应用过滤

- 若 `--lang python`：`rules-brief` 的 `--lang` 只传 python
- 若 `--owasp`：Phase 4 的 `cli.py scan` 加 `--owasp` 参数（引擎只加载 `priority: constitutional` 规则）
- 若 `--quick`：Phase 4 的 `cli.py scan` 用 `--mode quick`（引擎只应用 constitutional 规则到改动文件）

**Phase Gate 2（强制）**：
进入 Phase 3 前，MUST 验证以下全部条件（基于 rules-brief 输出）：
- [ ] `rule_count` ≥ 1
- [ ] `pattern_total` > 0
- [ ] 每条规则具备：rule_id、severity、categories

若 Phase Gate 2 失败：**停止并向用户报告错误。MUST NOT 进入 Phase 3。**

---

## Phase 3：范围确认 + 用户批准

### 步骤 1：确定扫描范围

引擎将扫描哪些文件，取决于模式：

- **全量（`--full`）**：项目全部源文件。范围由引擎在 Phase 4 收集（`scan_full` 内部 os.walk + 规则扩展名），此处无需手工列出。
- **增量（默认）**：Phase 0 的 `detect-changes.py` 输出的改动文件列表。用 Glob/Read 核对每个文件存在。
- **快速（`--quick`）**：同增量（改动文件），但 Phase 4 用 `--mode quick` 只对改动文件应用宪法规则。
- **自定义（`--files`）**：Phase 0 提供的文件列表。MUST 用 Glob 验证每个文件存在。

### 步骤 2：呈现给用户

MUST 使用 AskUserQuestion 工具呈现扫描计划并获得明确确认。

以 markdown 呈现（示例）：

```markdown
## Security Scan Plan (full mode, python detected)

| 项 | 值 |
|----|----|
| 模式 | full |
| 语言 | python |
| 规则数 | 16（constitutional 10 + supplementary 6）|
| 检测模式总数 | 147 |
| 文件数 | 引擎扫描后核对 scan-files.list |

引擎将对全部源文件执行确定性穷尽扫描（注释/文档字符串行自动过滤），
产出候选发现；之后由 AI 逐条语义验证、剔除误报、补齐修复字段。
```

MUST 在 AskUserQuestion 中包含：
- 扫描模式、语言、规则/模式总数
- 增量/快速：改动文件总数
- 确认选项："开始扫描" / "取消"

### 步骤 3：等待确认

用户明确批准前 MUST NOT 进入 Phase 4。
若用户要求修改（调整范围、增减语言），更新范围并重新确认。

**Phase Gate 3**：用户 MUST 明确批准。若未批准，MUST NOT 开始扫描。

---

## Phase 4：引擎穷尽扫描

调用引擎执行确定性穷尽扫描。**每次扫描在 `.sec-scan-code/scans/<时间戳>/` 下建独立目录**（记为 `<scan_dir>`，从引擎摘要的 `scan_dir:` 行获取），产出原始候选到 `<scan_dir>/findings.json`。
**智能体不再逐行套正则，也不再派 subagent 做规则匹配**——穷尽检查由确定性代码完成，
完整性有保证；智能体把能力留给 Phase 5 的判断性工作。

### 步骤 1：执行引擎扫描

按模式调用 `cli.py scan`：

```bash
# Linux/macOS/Git Bash（PLATFORM != windows-powershell）
# 全量
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['scan', '--mode', 'full', '--path', 'PROJECT_PATH', '--project', 'PROJECT_NAME']))"
# 增量（改动文件，来自 Phase 0 detect-changes 输出）
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['scan', '--mode', 'incremental', '--path', 'PROJECT_PATH', '--files', 'a.py', 'b.py']))"
# 快速（仅宪法规则 + 改动文件）
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['scan', '--mode', 'quick', '--path', 'PROJECT_PATH', '--files', 'a.py']))"
# 仅 OWASP 宪法规则（全量范围）
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['scan', '--mode', 'full', '--owasp', '--path', 'PROJECT_PATH']))"
```

> 若 `secscancode` 已 pip 安装，可用控制台入口：`sec-scan-engine scan --mode full --path PROJECT_PATH`。
> Windows PowerShell 用 `powershell -ExecutionPolicy Bypass -Command "..."` 包裹相同 python 命令。

引擎内部完成：语言检测（除非 `--lang` 指定）→ 规则加载 → 穷尽扫描（逐行正则 +
safe_patterns + **注释/文档字符串行自动过滤**）→ 去重 → **风险打分 + Top-K 分层** → 写入：
- `<scan_dir>/findings.json`：**高优先级候选（Top-K）**（`vuln_code`/`fix_code`/`exploit_scenario` 为空，待 Phase 5 补齐）
- `<scan_dir>/low-priority-candidates.json`：**低优先级候选**（受 `--top-k` 限制未进入深度验证，保留供人工复核/审计）
- `<scan_dir>/scan-files.list`：**完整覆盖清单**（交付件）——已扫描文件每行一个路径；无规则语言的文件以 `# SKIPPED: <原因>` 注释标注，打开即可核对"扫了哪些、跳过哪些及原因"

> 引擎扫描范围 = 规则语言扩展名（5 种语言 + **config**：`.yml/.yaml/.properties/.env` 的硬编码凭据规则）∪ detect-changes 的源文件扩展名（`.xml/.sql/.json/.sh` 等，无规则语言的文件记为 skipped）。构建输出目录（`target/`）与 skill 安装目录（`.codebuddy/.trae/.qoder`）自动排除。

**风险打分（risk_score）**：每条候选按 severity 权重 + confidence + **污点源信号**
（命中语言 YAML 的 `taint_sources`，如 `request.args`/`input()`）− 测试文件罚分 计算。
分数越高越优先送 LLM 深度验证。`--top-k N`（默认 0 = 全部进）控制送审上限，
`--per-category M`（默认 20）限制每类别进入送审集的条数，防止单条噪声规则占满预算。

### 步骤 2：核对扫描摘要与覆盖（强制）

引擎 stdout 输出摘要（files scanned / files skipped / 候选分层 / languages / rules）。

**MUST 读取 `<scan_dir>/scan-files.list` 核对覆盖**，并在输出中声明：
"已核对覆盖：N 文件扫描，M 文件跳过（原因分布）"。这是防漏扫的关键一步——不要只信任引擎摘要。

核对要点：
- **扫描文件数**：scan-files.list 中的普通行 = 已扫描；`# SKIPPED:` 行 = 未扫描
- **跳过原因**：`language_not_detected` = 该文件类型无规则（如 `.xml/.sql/.json`，属预期）；
  `unreadable_or_empty` = 读取失败，需排查
- 若发现明显是源码却因语言未检测被跳过（如新增语言、漏配扩展名），MUST 告知用户并考虑补扫
- 候选分层：`N high-priority + M low-priority`。N = findings.json 待审条数（≤ `--top-k`）；
  M = 低优先级条数（`low-priority-candidates.json`，不进入本会话深度验证，报告中标注待人工复核）
- 候选为 0 也要确认（可能项目确实干净，也可能是语言未覆盖）

### Phase Gate 4（强制）

MUST 验证：
- [ ] 引擎退出码 0，`findings.json` 已写入且结构完整
- [ ] `scan-files.list` 已写入
- [ ] 每条候选具备：文件路径、行号、code_snippet（非空）
- [ ] 无候选含编造内容（空片段、不可能的行号 > 文件长度）——候选来自引擎，天然可信，抽查即可

若任一失败，重新执行扫描；仍失败则告知用户。

---

## Phase 5：结果汇总 + 验证

### 步骤 1：确认候选 + 确定分析范围（强制）

`findings.json` 已由引擎在 Phase 4 写入 `<scan_dir>/findings.json`（`<scan_dir>` = `.sec-scan-code/scans/<时间戳>/`，从 Phase 4 摘要的 `scan_dir:` 行获取）。
**默认 `--top-k 0` = 全部候选**（含 file/line/code_snippet/rule_id/category/severity/
confidence/source/risk_score，`vuln_code`/`fix_code`/`exploit_scenario` 为空）；
若显式 `--top-k N` 则 findings.json 只含前 N（按类别限额，见参数说明）。

**无需手工合并/去重**——引擎已完成（去重 key：rule_id+file+line+category）。

#### 确定分析范围（关键决策点）

**优先全部分析**。仅当候选确实非常多（上下文无法一次承载，参考阈值 > 100 条）时，
MUST 用 AskUserQuestion 让用户选择分析范围，**不得擅自丢弃**：

呈现候选分解（来自 Phase 4 摘要的 `severity:` 与 `categories (top 10):` 行），提供选项：

| 选项 | `select` 命令 |
|------|--------------|
| 全部分析 N 条 | `select --strategy all`（默认） |
| 只分析高风险（CRITICAL/HIGH） | `select --strategy severity --severities CRITICAL,HIGH` |
| 按类别选择 | `select --strategy categories --categories sql-injection,xss` |
| Top-N（按风险分） | `select --strategy top-k --top-k N --per-category M` |
| 特定文件 | `select --strategy files --files a.py,b.go` |

`select` 命令从 `<scan_dir>/findings.json` 选出子集重写回 findings.json，未选中的
写入 `<scan_dir>/deferred-candidates.json`（保留供后续分析/人工复核，不丢弃）。

```bash
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['select', '--findings', '<scan_dir>/findings.json', '--strategy', 'top-k', '--top-k', '100', '--per-category', '20']))"
```

用户明确选择前 MUST NOT 跳过任何候选。选择后，本次分析范围 = findings.json 剩余候选。

后续步骤 2-4：MUST **逐条**处理 findings.json 中的候选（一次一条，Read 该条源码上下文 →
判定 → 补 vuln_code/fix_code → 用 Edit 写回该条字段），处理完一条即从工作记忆丢弃，
下一条再读入。这样主 agent 上下文常驻量恒定，且因分析范围有界而**与项目规模解耦**。
未入选的候选在 deferred-candidates.json 保留，报告输出时标注"N 条未深度验证，待人工复核"。

### 步骤 2：对照源码验证发现（强制）

MUST **逐条**处理 findings.json 中的发现（一次一条）：用 Read 工具读该 finding 对应的源码上下文，
验证后用 Edit 把结果写回该条字段（或删除误报条目），然后从工作记忆丢弃该条，再处理下一条。

对每个发现验证：
1. 在报告的行号处读取文件
2. 确认报告的 `code_snippet` 中的匹配行与实际文件内容一致
3. 确认该行确实匹配检测模式正则（参考该 category 的语言 YAML patterns，按需 Read）

丢弃未通过验证的发现（用 Edit 从 findings.json 删除该条）。在输出中记录丢弃数量。

### 步骤 3：AI 语义验证（强制）

对步骤 2 验证通过的每个发现，主 agent（非 subagent）MUST 执行 AI 语义分析，判断该发现是真实漏洞还是误报。这是消除基于正则扫描误报的精度层。

**核心原则**：不要限制分析深度。你可以读取整个函数、追踪调用链、跨文件分析。这是你相对于传统静态分析工具的优势 —— 充分利用它。

#### 三层分析框架

按顺序应用以下层次。若得出决定性结论，提前停止。

**L1：局部上下文（对所有发现强制）**

读取包含匹配行的完整函数/方法（不是固定行数 —— 通过定位 `def`/`function`/`func`/`class` 边界找到函数边界）。

检查：
- 匹配行是否在注释（`#`, `//`, `/* */`）或文档字符串（`"""`, `'''`）内？ → **误报**
- 匹配行是否在测试函数（名称含 `test_`, `Test`, `spec`, `_test`）内？ → **误报**
- 匹配行是否在字符串字面量内（正则匹配的是字符串内容，而非可执行代码）？ → **误报**
- 匹配行是否为文档中的刻意示例（例如在 `docs/` 目录或 README 中）？ → **误报**

若 L1 判定为误报，移除该发现并停止对该发现的进一步分析。

**L2：函数内数据流（对 injection/XSS/SSRF/path-traversal 类别强制）**

在同一函数体内，从匹配行向上追踪变量赋值链。参考该发现语言对应的已加载规则 YAML 中的 `taint_sources` 以确定数据来源。

检查：
- 匹配行使用的变量是否来自污点源
  （如 `request.args` → 变量 `uid` → 用于 `cursor.execute("..."+uid)`）？ → 更强信号
- 变量是否为硬编码常量、枚举或字面量，无任何用户可控输入可能？ → **误报**
- 变量是否由无用户可控参数的内部函数调用派生？ → 很可能安全
- 代码是否已使用输入验证/净化/参数化
  （如 `cursor.execute("...%s", (uid,))`, `bleach.clean()`, `escape()`）？ → 若完全缓解则 **误报**
- 该作用域内是否满足规则检测块中的 safety_conditions
  （如 `@login_required` 装饰器、函数体内的 `verify_token()` 调用）？ → **误报**

若 L2 判定为误报，移除该发现并停止对该发现的进一步分析。

**L3：跨文件调用链（L2 无法定论时应用）**

当匹配行的变量来自函数参数且 L2 无法确定其来源时，主动追踪调用方：

1. 用 Grep/Read 工具搜索当前函数的调用点
2. 在每个调用点，检查传入的参数
3. 若所有调用路径都从安全来源（常量、可信配置）传数据 → **误报**
4. 若任一调用路径从污点源传数据 → **确认漏洞**
5. 若调用链超过 3 层且来源仍未确定 → **需人工复核**

你可以读取多个文件以追踪完整数据流。这是你跨文件分析能力增值最大的地方 —— 传统工具无法可靠完成。

#### 判定决策矩阵

| 上下文 | 污点源 | 缓解措施 | 判定 |
|---------|-------------|------------|---------|
| 注释/文档/测试 | 任意 | 任意 | **误报** — 移除 |
| 真实代码 | 确认来自用户输入 | 无 | **确认漏洞** — 保留，原始置信度 |
| 真实代码 | 确认来自用户输入 | 部分 | **可能漏洞** — 保留，置信度 → max(5, confidence-2) |
| 真实代码 | 确认来自用户输入 | 完全 | **误报** — 移除 |
| 真实代码 | 硬编码常量 | 任意 | **误报** — 移除 |
| 真实代码 | 内部/可信来源 | 无 | **误报** — 移除 |
| 真实代码 | 可能但不确定 | 无 | **可能漏洞** — 保留，置信度 → max(5, confidence-2) |
| 真实代码 | 未知 | 未知 | **需人工复核** — 保留，标记复核 |

#### 所有发现判定完成后

1. **移除**所有判定为误报的发现
2. 对可能漏洞的发现**调整置信度**：`confidence = max(5, confidence - 2)`
3. 记录移除数量："AI 语义验证：移除 {n} 个误报，保留 {m} 个发现"

#### 分析参考

判定时参考 Phase 2 加载规则的以下字段：
- `taint_sources`（来自语言 YAML）：标识该语言/框架的用户输入来源
- `detection.taint_sinks`（来自规则条目）：确认匹配点是危险 sink
- `detection.safety_conditions`（来自规则条目）：使发现成为误报的条件
- `detection.steps`（来自规则条目）：需遵循的检测步骤

#### 边界情况

- **所有发现被移除**：若每个发现都判定为误报且发现列表为空，
  仍继续到步骤 4（跳过 —— 无发现需修复）、步骤 5 和 Phase 6。
  输出："所有发现均被 AI 判定为误报。"
- **调用链过深**：若追踪超过 3 层仍无决定性结果，
  标记为需人工复核而非猜测。
- **全量扫描模式**：AI 语义验证始终由**主 agent**执行
  （非 subagent），以确保所有发现判定标准一致。

### 步骤 4：生成修复建议（强制）

对每个验证通过的发现，主 agent（非 subagent）MUST 基于实际漏洞代码生成具体、贴合上下文的修复建议。这并非从规则 YAML 读取 —— agent 运用其代码理解能力产出定制化修复。

**结构化字段（MUST 填写，引擎会强制校验）：** 每个发现 MUST 同时填充以下
`Finding` 字段，缺失任一 `generate_report()` 将拒绝生成报告：
- `vuln_code`：原漏洞代码（逐字复制自源码，保持变量名）
- `fix_code`：修复后代码（保持变量名，可直接复制替换）
- `exploit_scenario`：攻击场景（引用实际代码元素）
- `recommendation`：一句话修复原则（可选，作为补充）

#### 对每个发现的流程：

**1. 读取带上下文的源文件（强制）**

MUST 用 Read 工具在发现周围读取至少 **15 行**上下文：
```
Read: {file_path}, offset={line - 7}, limit=15
```
这提供足够上下文理解变量名、函数签名和周围逻辑。

**2. 分析并生成 recommendation**

`recommendation` MUST 针对实际代码，而非通用建议。

**反面（通用 —— 禁止）：**
```
修复原则：使用参数化查询替代字符串拼接
修复代码：
使用参数化查询，避免SQL注入。
```

**正面（针对代码 —— 必需）：**
```
修复原则：使用参数化查询替代字符串拼接

修复代码：
# 原代码（第42行）：→ 对应 Finding.vuln_code
query = "SELECT * FROM users WHERE id=" + uid
cursor.execute(query)

# 修复后：→ 对应 Finding.fix_code（保持变量名 uid，可直接替换）
cursor.execute("SELECT * FROM users WHERE id=%s", (uid,))
```

每个发现 MUST 填充结构化 `Finding` 字段（这些在 HTML 报告中渲染为独立、清晰标注的区块，并由引擎强制校验）：
- `vuln_code`：实际漏洞代码，从文件逐字复制（含行号引用）
- `fix_code`：可直接复制粘贴的完整替换代码，保留原始变量名
- `exploit_scenario`：引用实际代码元素的具体攻击场景
- `recommendation`（可选）：一句话修复原则
`fix_code` MUST：
- 保留原始业务逻辑
- 可直接替换（非伪代码，非抽象描述）
- 使用与原代码相同的变量名

**3. 生成攻击场景**

`exploit_scenario` MUST 引用实际代码元素：
```
攻击场景：攻击者通过URL参数 uid=1%20OR%201=1 注入SQL，绕过认证获取所有用户数据。
```
而非通用表述："攻击者可利用SQL注入获取数据。"

**4. 质量门（继续前自检）**

对每个修复建议，自问：
- "修复后代码"是否包含实际代码语法（而非中文描述）？
- 是否使用与原代码相同的变量名？
- 是否可直接复制粘贴替换漏洞行？
- 若任一为否，重新读取源文件并再次生成。

**5. 记录到发现中**

为每个验证通过的发现填充结构化字段：
- `vuln_code` — 原漏洞代码（必填）
- `fix_code` — 修复后代码（必填）
- `exploit_scenario` — 攻击场景（必填）
- `recommendation` — 一句话修复原则（可选）
这些字段会在 HTML 报告卡片中渲染为独立的「原漏洞代码 / 修复后代码 / 攻击场景」区块。
`generate_report()` 会强制校验前三个字段非空，缺失将拒绝生成报告。

**关键：不得跳过此步骤。不得产出通用建议。每条修复建议 MUST 引用源文件中的具体代码。**

### 步骤 5：排序与格式化

排序：severity 降序（CRITICAL > HIGH > MEDIUM > LOW），然后 category 升序。

  **强制：文件位置 MUST 使用可点击的 `file:///` 链接。**
  输出中所有 file:line 引用 MUST 格式化为 markdown 链接，
  使用 `file:///` 协议、绝对路径和 `#L{line}` 锚点，
  以便用户点击直接跳转到 IDE 中的漏洞代码。

  格式：`[relative_path:line](file:///absolute/path/to/file#L{line})`

  输出摘要（强制格式，含可点击链接 —— 使用标准 Markdown 表格以提升可读性）：

  ```markdown
  ## SEC-SCAN RESULTS

  | Item | Value |
  |------|-------|
  | Mode | {incremental\|full\|quick} |
  | Files | {n} scanned, {m} lines |
  | Languages | {detected languages} |

  ### FINDINGS (sorted: severity desc, category asc)

  | # | Severity | Verdict | Category | Location | Fix Summary |
  |---|----------|---------|----------|----------|-------------|
  | 1 | CRITICAL | 确认漏洞 | command-injection | [user.py:42](file:///abs/path/user.py#L42) | subprocess.run 替代 os.system |
  | 2 | CRITICAL | 可能漏洞 | sql-injection | [user.py:38](file:///abs/path/user.py#L38) | 参数化查询替代字符串拼接 |
  | 3 | HIGH | 确认漏洞 | hardcoded-secret | [settings.py:15](file:///abs/path/settings.py#L15) | os.environ.get() |
  | 4 | HIGH | 需人工复核 | ssrf-url | [handler.js:18](file:///abs/path/handler.js#L18) | URL白名单验证 |
  | 5 | MEDIUM | 确认漏洞 | cors-wildcard | [main.py:15](file:///abs/path/main.py#L15) | 域名白名单替代 * |

  **TOTALS: 2 CRITICAL, 2 HIGH, 1 MEDIUM** (已移除 {n} 个误报)

  > 另 {m} 条低优先级候选未进入深度验证（见 `<scan_dir>/low-priority-candidates.json`，受 `--top-k` 限制），建议人工复核。

  > ⚠ AI扫描不完善风险：可能遗漏复杂漏洞链、跨文件数据流漏洞、运行时才触发的漏洞。建议结合专业安全审计工具使用。
  ```

**可点击链接的重要规则：**
1. MUST 在 `file:///` URL 中使用绝对文件路径（非相对路径）
2. MUST 追加 `#L{line_number}` 锚点，以便 IDE 跳转到精确行
3. MUST 在 file:/// URL 中使用正斜杠 `/`，即使在 Windows 上
4. 显示文本应为 `relative_path:line` 以提升可读性
5. MUST 包含"Fix Summary"列，简明展示修复原则
6. 此可点击链接格式同时适用于聊天输出和 HTML 报告

### 步骤 6：AI 局限性提示

MUST 在所有结果（文本、JSON 等）中追加 AI 局限性提示。

### 步骤 7：确保 findings.json 就绪（强制，供 Phase 6 使用）

**所有模式**：findings.json 已在 Phase 4 由 `cli.py scan` 生成（含 file/line/code_snippet/
rule_id/category/severity/confidence/source，`vuln_code`/`fix_code`/`exploit_scenario` 为空）。
步骤 2-4 是**逐条用 Edit 修改**该文件中对应 finding 的字段（补 vuln_code/fix_code/exploit_scenario、
移除误报条目）。本步骤只需确认 findings.json 已存在且每条保留的 finding 字段完整（无需重写整文件）。

findings.json schema（引擎生成，字段与 Finding dataclass 对齐）：

```json
{
  "project": "PROJECT_NAME",
  "project_path": "ABSOLUTE_PROJECT_PATH",
  "scan_mode": "full|incremental|quick",
  "scan_date": "2026-07-31 16:00:00",
  "scan_duration": "2m 35s",
  "languages_detected": ["python", "c"],
  "rules_loaded": ["A01", "A05", "XSS"],
  "scan_scope": {
    "files_skipped": [],
    "dirs_skipped": [".git", "node_modules"]
  },
  "findings": [
    {
      "id": 1,
      "rule_id": "A05-INJECTION",
      "rule_name": "Injection",
      "severity": "CRITICAL",
      "confidence": 8,
      "category": "sql-injection",
      "language": "python",
      "file": "app/user.py",
      "line": 42,
      "code_snippet": "query = \"SELECT * FROM users WHERE id=\" + uid",
      "description": "字符串拼接 SQL，存在注入风险",
      "recommendation": "使用参数化查询替代字符串拼接",
      "exploit_scenario": "攻击者通过 uid=1 OR 1=1 注入，绕过认证获取全部用户数据",
      "vuln_code": "query = \"SELECT * FROM users WHERE id=\" + uid\ncursor.execute(query)",
      "fix_code": "cursor.execute(\"SELECT * FROM users WHERE id=%s\", (uid,))",
      "source": "constitutional"
    }
  ]
}
```

**MUST** 从实际扫描数据填充：
- `languages_detected`：Phase 1 检测到的语言
- `rules_loaded`：Phase 2 加载的规则 ID 列表
- `scan_scope.dirs_skipped`：排除的目录（`.git`, `node_modules`, …，可选）
- `scan_scope.files_skipped`：跳过的文件及原因（可选）
- 每个发现 MUST 包含 `vuln_code` / `fix_code` / `exploit_scenario`
  （否则引擎拒绝生成报告）

> 扫描文件清单（`files_scanned`）已在 Phase 4 落盘到 `<scan_dir>/scan-files.list`，
> **不要在 findings.json 重复填写** —— 直接看那个文件即可核对扫描范围。

**这是纯数据。** 使用 Write 工具写入 JSON 字符串。不要编写 `.py` 脚本构建报告 —— 那是 Phase 6 的工作，由引擎完成。

---

## Phase 6：结果持久化

### 步骤 1：确定输出格式

检查 `--formats` 参数：
- 未指定 → `["html", "json"]`（默认）
- `--formats json,html` → `["json", "html"]`
- `--formats json` → `["json"]`
- `--formats html` → `["html"]`

支持的格式仅 `json`、`html` 两种（`xml`、`csv` 不再支持，传入会被静默忽略）。
扫描文件范围记录在 `<scan_dir>/scan-files.list`（Phase 4 已落盘，交付件），
直接打开该文件即可核对扫描范围，无需作为报告格式生成。

**MUST 生成所有请求的格式。** 默认情况下，MUST 生成 .html 和 .json 文件。

### 步骤 2：通过引擎生成报告（所有模式强制）

Phase 5 已补齐 `<scan_dir>/findings.json`（纯数据，每条含 vuln_code/fix_code/exploit_scenario；
`<scan_dir>` = `.sec-scan-code/scans/<时间戳>/`，从 Phase 4 摘要获取）。
Phase 6 通过引擎读取它 —— agent 不编写任何 Python 代码，也不手工构造 `ScanResult`/`Finding` 对象。

**调用 `cli.py report`**，内部调用 `generate_report_from_json()`：
读取 findings.json → 构造 ScanResult → 去重/排序/compute_totals → 强制合规门
（vuln_code/fix_code/exploit_scenario，缺失则拒绝生成）→ 写入 findings.json 所在目录（即 `<scan_dir>`）：

```bash
# Linux/macOS/Git Bash（PLATFORM != windows-powershell）
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['report', '--findings', '<scan_dir>/findings.json', '--formats', 'json,html']))"
```

报告生成并验证无误后，MUST 再执行一次 **`report --finalize`** 清理中间产物，
使 `<scan_dir>` 只保留交付件（报告 + scan-files.list）：

```bash
$PYTHON_CMD -c "import sys; sys.path.insert(0, r'{{SKILL_DIR}}'); from secscancode.cli import main; sys.exit(main(['report', '--findings', '<scan_dir>/findings.json', '--formats', 'json,html', '--finalize']))"
```

引擎：
- 读取 findings.json → 内部构造 `ScanResult` + `Finding` 对象
- 强制合规：若任一发现缺少 `vuln_code`/`fix_code`/`exploit_scenario` 则拒绝生成
  （修复发现，重写 findings.json，重新运行）
- 将 `scan_{mode}_{timestamp}.{html,json}` 写入 findings.json 所在目录（`<scan_dir>`）
- `--finalize`：报告成功后删除 `<scan_dir>/findings.json` 与
  `<scan_dir>/low-priority-candidates.json`（中间产物），只留交付件

**❌ 禁止手写 Python 脚本拼装 ScanResult。** 不要创建 `generate_report_full.py`、
`finalize_report.py`、`phase5_report.py` 等文件 —— 报告构建逻辑在 `reporter.py` 中，
通过 `cli.py report` 调用。Phase 6 不写任何文件 —— `findings.json` 在 Phase 5 写，
报告文件由引擎在 Phase 6 生成。

**MUST NOT** 跳过报告生成。**MUST NOT** 仅在聊天中以文本输出发现。HTML/JSON 文件 MUST 写入磁盘。

### 步骤 3：验证所有报告（Phase Gate 6）

MUST 用 Read 工具验证每个生成的报告文件：
- 读取每个文件前 5 行
- 确认文件非空且格式良好

**MUST 用引擎校验 JSON 报告为标准 schema**（防止绕过引擎手写非标准报告）：

```bash
$PYTHON_CMD -c "
import sys; sys.path.insert(0, r'SKILL_DIR')
from secscancode.reporter import validate_report_schema
errs = validate_report_schema('<scan_dir>/scan_full_TIMESTAMP.json')
if errs:
    print('❌ 报告非引擎标准产物：'); [print('  -', e) for e in errs]
    sys.exit(1)
print('✅ JSON 报告为引擎标准 schema')
"
```

若校验返回非空错误列表，说明报告未走 `generate_report()` / `generate_report_from_json()`
（例如用了 `report_metadata` 包裹结构、findings 缺 `vuln_code`/`fix_code`/`exploit_scenario`、
缺少顶层 `scan_scope` 字段）。**MUST 重走步骤 2**：修正 findings.json
并重新调 `generate_report_from_json()`，直到校验通过。

示例：
```
Read: .sec-scan-code/scans/20260529_120000/scan_full_20260529_120000.json
Read: .sec-scan-code/scans/20260529_120000/scan_full_20260529_120000.html
```

**Phase Gate 6**：MUST 验证每个请求的格式文件存在且非空，**且 JSON 报告通过
`validate_report_schema()` 校验**（确认为引擎标准产物）。
若任一文件写入失败，重试一次。若仍失败，告知用户。

### 步骤 4：向用户输出报告摘要

所有报告生成并执行 `report --finalize` 后，MUST 输出：
```
Reports generated (交付件):
  HTML: .sec-scan-code/scans/20260529_120000/scan_full_20260529_120000.html (14 findings)
  JSON: .sec-scan-code/scans/20260529_120000/scan_full_20260529_120000.json (14 findings)
  Scan scope: .sec-scan-code/scans/20260529_120000/scan-files.list (138 files scanned, 10 skipped)
```

---

## Phase Gate 汇总

| Gate | 所在 Phase 之后 | 验证内容 | 失败时处理 |
|------|------------|-------------|------------|
| Gate P | Phase P | 检测到有效平台（linux/macos/windows） | 请用户指定平台 |
| Gate 0 | Phase 0（增量/快速）或 Phase 4（全量） | 找到 ≥1 个源文件 | 停止，告知用户 |
| Gate 1 | Phase 1 | 检测到 ≥1 种语言 | 请用户指定 --lang |
| Gate 2 | Phase 2 | rules-brief 显示 rule_count ≥1 且 pattern_total >0 | 停止，报告错误 |
| Gate 3 | Phase 3 | 用户明确批准扫描计划 | 等待，MUST NOT 继续 |
| Gate 4 | Phase 4 | 引擎退出码 0，findings.json / scan-files.list 已写入 | 重新执行扫描，仍失败则告知用户 |
| Gate 5 | Phase 5 | 所有发现已对照代码验证 + AI 语义验证完成 + 每个发现含 vuln_code/fix_code/exploit_scenario + findings.json 已写入 | 丢弃无法验证的发现，移除误报，补全缺失修复字段，写入 findings.json |
| Gate 6 | Phase 6 | 所有请求的格式文件存在、非空，generate_report 通过合规校验，**且 JSON 报告通过 validate_report_schema() 校验为引擎标准产物** | 重走步骤 2 调 generate_report_from_json() 重新生成，直到 schema 校验通过 |

---

## 规则架构（参考）

规则分为**查什么**（OWASP 元数据）和**怎么查**（语言模式），在扫描时合并：

```
OWASP YAML（查什么）  ×  语言 YAML（怎么查）  →  完整规则
─────────────────────────────     ─────────────────────────────     ──────────────
rule_id: A05-INJECTION           language: python                 A05 with python
categories: [sql-injection,      rules:                            patterns:
  command-injection, ...]          - category: sql-injection        sql-injection: [...]
                                    owasp: A05                    command-injection: [...]
                                    patterns: [...]
```

**OWASP Top 10:2025 映射：**

| ID  | 类别                              | 2021 ID | 关键变化 |
|-----|---------------------------------------|---------|------------|
| A01 | 访问控制失效 (Broken Access Control)                 | A01     | 现包含 SSRF（原 A10:2021） |
| A02 | 安全配置错误 (Security Misconfiguration)             | A05     | 上移 |
| A03 | 供应链失效 (Supply Chain Failures)                 | A06     | 更名 + 扩展 |
| A04 | 加密失败 (Cryptographic Failures)                | A02     | 下移 |
| A05 | 注入 (Injection)                             | A03     | 下移 |
| A06 | 不安全设计 (Insecure Design)                       | A04     | 下移 |
| A07 | 身份识别与认证失效 (Identification & Auth Failures)        | A07     | 不变 |
| A08 | 软件与数据完整性失效 (Software & Data Integrity Failures)    | A08     | 不变 |
| A09 | 安全日志与监控失效 (Security Logging & Monitoring Failures)| A09     | 不变 |
| A10 | 异常情况处理不当 (Mishandling of Exceptional Conditions) | NEW     | 2025 新增 |

优先级顺序（最高在前）：
1. **宪法文件 2**（项目特定，来自 `--analyze`）—— 最高优先级
2. **宪法文件 1**（OWASP Top 10:2025）—— 始终加载
3. **补充规则** —— 在 `--full` 或显式请求时加载

规则文件（均位于 `{{SKILL_DIR}}/rules/`）：
- `owasp/*.yaml` — OWASP 漏洞元数据（10 个文件）
- `supplementary/*.yaml` — 补充规则元数据（5 个文件）
- `languages/*.yaml` — 语言特定模式（5 个文件）
- `constitution-owasp.yaml` — 宪法简报（OWASP）
- `constitution-project.yaml` — 项目特定宪法

---

## Phase 7：大数据分析（`--analyze`）

从 `.sec-scan-code/scans/*/` 与 `.sec-scan-code/reports/`（旧布局）读取所有历史扫描结果。
按类别、规则、文件统计最常见的漏洞。
用前 N 个发现更新 `constitution-project.yaml`。
这些成为项目特定宪法规则，优先级最高。

---

## 宪法注入（用于编码会话）

当新的编码会话开始时，注入宪法简报：

```bash
$PYTHON_CMD {{SKILL_DIR}}/bin/generate-constitution-brief.py
```

这会输出约 200 tokens，含规则 ID + severity + 一行描述。
遇到可疑代码时按需读取完整规则详情。

或者使用 MCP 工具 `sec_scan_get_constitution_brief`。

---

## MCP 部署

扫描引擎也可作为 MCP server 提供。在 `{{AGENT_CONFIG_DIR}}/settings.json` 中配置：

```json
{
  "mcpServers": {
    "sec-scan-code": {
      "command": "python",
      "args": ["-m", "secscancode.server"],
      "cwd": "{{SKILL_DIR}}"
    }
  }
}
```

可用 MCP 工具：
- `sec_scan_incremental` — 增量扫描
- `sec_scan_full` — 全项目扫描
- `sec_scan_quick` — 快速宪法扫描
- `sec_scan_analyze` — 大数据分析
- `sec_scan_list_rules` — 列出可用规则
- `sec_scan_get_constitution_brief` — 获取宪法以注入

---

## Python 脚本参考

这些脚本是统一用 Python 实现、可从命令行调用的独立工具（跨平台，用 Phase P 检测的 `PYTHON_CMD` 调用）：

| 脚本 | 路径 | 用途 |
|--------|------|---------|
| detect-changes.py | `{{SKILL_DIR}}/bin/detect-changes.py` | 检测 git 工作区中变更的源文件（增量扫描范围） |
| detect-languages.py | `{{SKILL_DIR}}/bin/detect-languages.py` | 检测项目语言（两阶段：指示文件 + 扩展名） |
| generate-constitution-brief.py | `{{SKILL_DIR}}/bin/generate-constitution-brief.py` | 生成宪法简报以注入 |
| hook-auto-scan.py | `{{SKILL_DIR}}/bin/hook-auto-scan.py` | PostToolUse 钩子：文件改动时自动扫描（Claude Code hook 配置用） |
| hook-inject-constitution.py | `{{SKILL_DIR}}/bin/hook-inject-constitution.py` | UserPromptSubmit 钩子：注入宪法（Claude Code hook 配置用） |

> hook-*.py 仅用于 Claude Code 的 hooks 配置，不在扫描 Phase 中手动调用。

---

## 重要规则

- **默认增量，非全量。** 全量扫描开销大，MUST 通过 `--full` 显式指定。
- **语言感知。** MUST 仅用检测到语言的规则扫描。
- **宪法优先。** OWASP + 项目特定规则 MUST 优先检查。
- **只读。** MUST 永不修改源代码。仅产出发现与修复建议。
- **AI 局限性。** MUST 在结果中始终包含 AI 局限性提示。
- **置信度评分。** 每个发现 MUST 含 1-10 置信度。低于 7 = 加注保留说明。
- **OWASP 2025。** 规则遵循 OWASP Top 10:2025 编号。SSRF 归入 A01。
- **规则驱动。** MUST 用已加载规则模式扫描。MUST NOT 依赖通用 AI 知识找漏洞。
- **验证发现。** MUST 在报告前对照实际源码验证每个发现。
