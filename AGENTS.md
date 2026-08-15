# 数字员工套件 2.0 — Codex 项目规则

## 项目上下文

- `CLAUDE.md` 是本仓库的顶层架构约束；开始工作前先读取并遵守它。
- 修改架构、模块边界或底座适配方式前，必须先读取 `docs/design/数字员工套件2.0架构白皮书-v0.7.md`。
- 项目采用单 Agent + 多 Skill，不把多 Agent 设为默认实现架构。

## 默认开发方式：Spec Coding

除纯解释、只读调研、极小文案修改外，功能新增、行为修改、重构和缺陷修复都必须先规格、后代码：

1. 使用 `superpowers/brainstorming` 澄清问题、用户结果、边界与备选方案。
2. 使用 `speckit` 在 `specs/###-feature/` 建立或更新四个且仅四个功能产物：
   - `spec.md`
   - `decisions.md`
   - `plan.md`
   - `tasks.md`
3. 规格和计划没有覆盖验收场景时，不开始实现。信息缺失但不阻塞时，在规格中记录明确假设并继续。
4. 实现按 `tasks.md` 顺序进行；使用 `superpowers/test-driven-development` 执行 RED → GREEN → REFACTOR，并在完成后勾选任务。
5. 缺陷和失败先使用 `superpowers/systematic-debugging` 定位根因，再进入测试驱动修复。
6. 交付前使用 `superpowers/verification-before-completion` 做新鲜验证；需要评审时使用 requesting/receiving-code-review。

## 产物与冲突规则

- `specs/###-feature/` 是需求、决策、计划和任务的唯一事实来源。
- Superpowers 的 `writing-plans` 方法可以用于拆解任务，但不得另建 `docs/superpowers/plans/`；把结果写入对应功能目录的 `plan.md` 和 `tasks.md`。
- 每项实现任务和验证任务都必须能追溯到用户故事及 Given/When/Then 验收场景。
- 重要技术取舍写入该功能的 `decisions.md`；不要只留在对话里。
- 用户明确要求跳过某个流程时，以用户指令为准，并在交付说明中标记被跳过的验证或风险。

## 工作边界

- 优先复用仓库现有模式、接口和测试方式，避免无关重构。
- 不得用“应该可用”代替验证结果；完成声明必须附实际执行的检查及结果。
- 未经用户明确要求，不自动启用 Superpowers 的并行/子代理流程。
