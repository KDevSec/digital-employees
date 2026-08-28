# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-08-01

### Added

- **引擎优先架构**：扫描由确定性引擎穷尽完成（`cli.py scan`），LLM 只做语义验证/补修复字段，不再逐行套正则
- **`secscancode/cli.py`**：`scan` / `rules-brief` / `report` / `select` / `analyze` 五个子命令暴露引擎
- **风险打分 + 送审分层**：候选按 severity×confidence×污点信号打分，`--top-k`/`--per-category` 控制送审集
- **每次扫描独立目录**：`.sec-scan-code/scans/<时间戳>/`，`report --finalize` 清理中间产物只留交付件
- **配置文件规则**（CONFIG-SECRETS）：扫描 `.yml/.yaml/.properties/.env` 硬编码凭据
- **并行扫描**：≥30 文件时 `ProcessPoolExecutor` 多进程按文件并行（自动回退顺序，`--workers`）
- **用户可选分析范围**：候选多时 SKILL.md 用 AskUserQuestion 让用户选，`select` 命令落地，未选中的进 `deferred-candidates.json`
- **skill 自带 .venv**：install.sh 创建 `.venv` 装依赖，SKILL.md 优先用 venv python
- **完整覆盖清单**：`scan-files.list` 展示已扫描 + `# SKIPPED`（未扫描及原因），覆盖透明

### Changed

- 全部 `bin/*.sh` / `bin/*.ps1` 转为 Python（`bin/*.py` + `secscancode/git_changes.py`），跨平台统一
- 语言检测排除 `node_modules` 等依赖目录；注释/文档字符串/纯字符串行过滤消除误报
- 供应链攻击规则优先级 `supplementary` → `constitutional`
- `--analyze` 宪法写入项目 `.sec-scan-code/`（不再写 skill 安装目录，消除跨项目污染）
- MCP 工具改为**只扫描返回发现**（报告走 CLI `report` 补字段后生成），移除 MCP tools 的 `formats` 参数
- SKILL.md 精简并重写为「引擎优先」流程

### Fixed

- 修复 5 个无法编译的规则正则（java Cookie 不平衡括号、c toctou、java `***` safe 模式）
- SKILL.md cli 调用 `sys.exit(main(...))` 传播退出码（合规拒绝不再被吞），并修复 5 处缺右括号的语法错误
- `rules-brief` 无 `--lang` 时加载全部语言（不再 16 个空壳规则）
- `select_review_set` 默认 `per_category=0`（不再静默截断 `--top-k`）
- `scan_quick` 补 `workers` 形参（CLI/MCP quick 模式 TypeError）
- MCP `sec_scan_full` handler 重复传 `project_path` 导致 TypeError；`_do_scan` 不再立即 `generate_report` 撞合规门
- 规则加载不再就地变异共享 Pattern

## [2.1.0] - 2026-06-16

### Added

- 命令行安装脚本 `install.sh`（macOS/Linux）和 `install.ps1`（Windows），支持交互式选择智能体和安装级别
- 支持 Claude Code、Trae、CodeBuddy 三种智能体的自动安装
- 支持用户级和项目级两种安装模式
- 项目级安装时必须提供 `--project-path` 参数，确保路径正确
- `.gitattributes` 文件，确保 `.sh` 脚本在 Git 中始终使用 LF 换行符

### Changed

- SKILL.md 中所有硬编码路径替换为 `{{SKILL_DIR}}` 和 `{{AGENT_CONFIG_DIR}}` 占位符，安装时由脚本替换
- `bin/detect-languages.sh` 中 `declare -A` 关联数组替换为 `case/esac`，兼容 macOS Bash 3.2
- `bin/generate-constitution-brief.sh` 中 `{{SKILL_DIR}}` 替换为 `$RULES_DIR` 变量
- SKILL.md Phase 0 增量扫描的 git diff 命令简化，不再按平台分别写代码块
- SKILL.md Phase 1 语言检测改为按平台选择 `.sh` 或 `.ps1` 脚本
- SKILL.md Phase 5 Step 3 输出格式改为 `file:///` 可点击链接，新增 Fix Summary 列
- SKILL.md Phase 6 报告生成更新为 `generate_report()` 统一接口，补充 `ScanResult` 必填字段说明
- AI 安全规则（`.trae/rules/`、`.codebuddy/rules/`）改为独立打包安装，不再由安装脚本处理
- README.md 项目结构中移除 `.trae/` 和 `.codebuddy/` 目录
- 所有 `bin/*.sh` 文件换行符从 CRLF 转换为 LF

### Fixed

- 修复 `detect-languages.sh` 在 macOS Bash 3.2 下因 `declare -A` 不支持而无法执行的问题
- 修复 `.sh` 文件在 Linux/macOS 上因 CRLF 换行符导致 `/usr/bin/env bash\r: No such file or directory` 的问题

## [2.0.0] - 2026-06-12

### Changed

- **项目重命名**: `sec-scan` → `sec-scan-code`
- **Python 包名重命名**: `secscan` → `secscancode`（影响所有 import 路径和模块引用）
- **数据目录重命名**: `.sec-scan/` → `.sec-scan-code/`（报告输出目录和 gitignore）
- **MCP Server 名称**: `sec-scan` → `sec-scan-code`
- **XML 报告标签**: `<sec-scan-report>` → `<sec-scan-code-report>`
- **HTML 报告页脚**: `sec-scan` → `sec-scan-code`
- **pyproject.toml 包名**: `sec-scan-mcp` → `sec-scan-code`
- **控制台入口点**: `sec-scan-mcp` → `sec-scan-code`
- **版本号**: `1.0.0` → `2.0.0`（因重命名涉及破坏性变更，主版本号升级）

### Added

- `secscancode/__init__.py` 中新增 `__version__` 和 `__project_name__` 属性
- 创建 `CHANGELOG.md` 记录版本变更历史

### Breaking Changes

- Python import 路径从 `secscan.*` 变更为 `secscancode.*`，需要更新所有引用
- 扫描报告目录从 `.sec-scan/` 变更为 `.sec-scan-code/`，已有扫描结果需手动迁移
- MCP Server 配置中的 `args` 需从 `secscan.server` 更新为 `secscancode.server`
- Claude Code Skill 安装路径从 `~/.claude/skills/sec-scan` 更新为 `~/.claude/skills/sec-scan-code`

## [1.0.0] - 2025-06-10

### Added

- 基于 OWASP Top 10:2025 的多语言安全扫描器
- 支持 Python、JavaScript、Go、Java、C 五种语言
- 宪法优先级系统（双层宪法文件驱动扫描优先级）
- 三种扫描模式：增量扫描、全量扫描、快速扫描
- 大数据分析：历史扫描趋势分析，自动更新项目宪法
- 多格式报告：JSON、XML、CSV、HTML
- MCP Server 部署支持（6 个工具）
- Claude Code Skill 支持
- Trae Skill 支持（AI 代码生成安全规则 + 主动扫描技能）
- CodeBuddy Skill 支持（AI 代码生成安全规则 + 主动扫描技能）
- 补充规则：CSRF、XSS、路径穿越、不安全反序列化、竞态条件
