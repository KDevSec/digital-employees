# 模板 skill 物料：剩余批次清单（L1 实施批输入）

> 已完成（本批，2026-08-27）：15 份现成改写（1.0 仓 `plugins/agents-team/skills/` 直拷 + devzero 化：
> frontmatter name 去 `ieidev-` 前缀、跨 skill 引用去 `agents-team:` 前缀、`.ieidev/`→`.devzero/`，
> 每份头部留来源注记，副文件 references/LICENSE 随行）+ review-verdict 新写 1 份。
> 分配：dev-engineer×5 / req-clarifier×5 / sys-engineer×5 / reviewer-expert×1（新写）。

## L1 打磨批（语义级改写，fable 评审 #6/#7/#8 遗留）

| # | 项 | 说明 |
|---|----|------|
| 5 | kdev-gen 七件套 V4x.1 流程词汇降级 | 体内 nodes-data/准入 prompt-check.sh/veto 编号/迭代档案坐标（`迭代N/vX-<版本>/03-design/`）等 1.0 V4x.1 SOP 词汇未做语义级清理（本批仅机械替换：前缀/.ieidev→.devzero）——L1 打磨为通用方法论措辞或补齐规范副文件随行 |
| 6 | writing-plans 残留复查 | 已改两处主从指令（评审 #6）；其余 superpowers 语境词汇（spec/reviewer-prompt 引用文件随行情况）L1 复核 |

## 剩余（留 L1 线实施批）

| # | 项 | 来源 | 动作 | 备注 |
|---|----|------|------|------|
| 1 | sec-scan-design（sec-design 的 skill） | `reference-projects/安全skill/` zip | 解包 → SKILL.md frontmatter 校验 → 进 `templates/sec-design/skills/sec-scan-design/` | SKILL.md + 12 模块 133 条规则；纯 LLM 语义 skill 开箱即用 |
| 2 | sec-scan-code（sec-code 的 skill） | 同上 zip | 同上 → `templates/sec-code/skills/sec-scan-code/` | Python 扫描引擎 + OWASP Top 10:2025；**`.venv`（~40MB）经 install 脚本装员工 home，不进包不分发**（D-044） |
| 3 | secretgate（sec-compliance 的 skill） | 1.0 仓 `plugins/agents-team/pyieidev/ieidev_hud/secretgate.py`（正则规则引擎） | **已裁决（T11）：a) TS 移植为 skill 内置脚本** + A1 员工形态（LLM 做定性解读，见 sec-compliance AGENTS.md 分工段）；规则集 = API Key/私钥/连接串/凭证模式 |
| 4 | hooks/redlines/ 拦截脚本本体 | 规则库定义（员工模板设计 §5 + shared-protocol v0.2 §2.1 rule_id 枚举） | 实现 `no-push-to-main` / `no-devzero-state` / `no-external-request` 等 compiled 规则的可执行脚本（1.0 有 `.cmd` 包装器先例） | 与 hooks.json 预编译产物配套；红线规则内容随 Q-T4 裁决定格 |

## 模板物料校验现状

- manifest.yml ×7：YAML 合法、id=目录名、skills/redlines 计数符合定稿（§5 表）✅
- hooks/hooks.json ×7：JSON 合法（Python json 校验）✅
- dev 个人表：YAML 合法、节点 id 唯一、next/gate 引用完整、terminal_fail/delivery_node 在表内 ✅
- skills ×16：frontmatter name=目录名、description ≥10 字（sr/ar 为多行折叠块，单行校验脚本误报、内容合格）✅
- **未做**（待 I0-4 zod 真源落仓后接 CI）：manifest 全量 schema 校验、SKILL.md 双引号规范复核


## fable 评审修复批记录（2026-08-27，随本分支提交）

已修：🔴#1 schema template_id 改 optional / 🔴#2 frontmatter 增 vendored_from+license / 🟡#3 个人表 self 契约补注（Q-selfgate 登记）/ 🟡#4 sec-compliance blocked 表述改停跑+handoff / 🟡#5 设计 §4 评审位三件套变体 / 🟡#6 writing-plans 主从两处 / 🟡#7 brainstorming 条件式+proto 依赖声明降级 / 🟡#9 LICENSE×4 补齐 / 🟡#10 sec 三员 skills 摘除对账 / 🟡#11 占位邮箱 / 🟡#12 kind 判据 / ⚪#13 节点计数 / ⚪#15 变更记录补 audit / ⚪#16 evals+tests 删除。未动：#14（合并自愈）/ #17（Q-verify 与 I3 收口）。
