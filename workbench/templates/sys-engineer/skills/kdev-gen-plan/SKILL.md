---
name: kdev-gen-plan
description: plan 节点的产物生成 SKILL（V4x.1·忠实 superpowers:writing-plans 骨架·author 模式）——按 writing-plans 结构(Plan 头→File Structure→Tasks〔每 task 五步〕→三关卡收尾→Self-Review)、依上游详细设计(已定稿·权威源)+前序版本 plan/code-review 生成 plan 初稿。⚠️ 写 HOW 节点·反转 AR 纪律：不设「禁实现细节」，反而 MUST 给实质有效的真实测试码/可运行实现/精确路径/命令。无占位符尤严(TODO/TBD/similar to Task N=失败)、类型跨 task 一致、spec 全覆盖、三关卡含安全门、不吞安全 Error 不用 --no-verify 跳门。打回重做时 MUST 吃前轮失败教训。料（上游产物+坐标[+前轮教训]）由生成提示词喂入。Use when 准入 pass 且详设已定稿后生成/整改/重做 plan 产物。
---

<!-- devzero 物化：源自 1.0 仓 plugins/agents-team/skills/kdev-gen-plan（2026-08-27，devzero 化改写） -->

# kdev-gen-plan · plan 产物生成（author·忠实 superpowers:writing-plans）

**开场播报**："我在用 kdev-gen-plan 生成 <版本> 实施计划（author 模式·忠实 writing-plans·写 HOW）。"

> **V4x.1 形态**：本 SKILL 把 plan 规范（忠实 `superpowers:writing-plans`）+ 生成纪律封装成可调生成器。`0b-生成提示词模板` 因此变薄——只喂坐标+上游料并**调本 SKILL**，不再贴整段生成指令。
> **节点定位**：plan = **写 HOW（任务拆解+完整代码）的单产物节点**（T2·忠实 writing-plans·非评审组）。`profile:框架`，**重 C-SEC-GATE**（不吞安全 Error、不用 `--no-verify` 跳门）。

## 吃什么（生成提示词喂入）
> **输入骨架与必填字段以 `nodes-data/plan/prompt-template.md` 为准（占位模板+机检参数单一真源·准入 `prompt-check.sh` 依它核）；本段只述各料语义。**
- 坐标：迭代 / 版本（vX-名）/ 落位 `迭代N/vX-<版本>/04-impl/plan.md`。
- 本轮模式：首次生成 / 整改第K轮 / 打回重做。
- **plan 规范模板**（忠实 `superpowers:writing-plans`，如 `references/plan规范.md`）。骨架：§2.1 Plan 头(Goal/Architecture/Tech Stack/Global Constraints) → §2.2 File Structure(任务前先做·一文件一职责) → §2.3 Tasks(每 task = Files+Interfaces + 五步: 写失败测试/跑验证 FAIL/最小实现/跑验证 PASS/Commit) → §2.4 三关卡收尾 task → §2.6 Self-Review。
- **上游产物**：
  - **详细设计（前提：已定稿·权威源）** （逐条把详设的数据模型/接口契约/关键流程/测试策略转成可执行 task）。
  - 〔非首版本〕前序版本 plan / code-review / security-scan（**复用 + 吸收发现**·复用拆解形状与代码复用点·把前序 review/安扫发现显式写入「复用 X、规避坑 Y」）。
- **profile**：profile:框架（既有命名/结构/契约，如 Ruoyi 约定）——File Structure 与代码 follow 既有代码库模式。
- 〔打回重做/整改 时 MUST 含〕前轮便签的 **veto 失败项 + 主要扣分点**（已知坑清单）。

## 生成（忠实 writing-plans·MUST）
1. **忠实 writing-plans 五步骨架 + 三关卡·别改其结构**：每 task = 最小独立可测、可被评审者单独 gate 的单元；五步逐步一动作(2-5 分钟)：写失败测试 → 跑验证 FAIL(命令+预期) → 写最小实现 → 跑验证 PASS(命令+预期) → Commit(git 命令·message 引用 task ID)。**不改 writing-plans 结构、不加它没有的结构要求。**
2. **⚠️ 写 HOW·不分区（关键·反转 AR·别照搬 AR 的禁实现）**：plan **就是写完整代码/精确文件路径/命令/任务拆解的地方**——**MUST 给**实质有效的代码（写失败测试 step 给真实测试代码、最小实现 step 给真实可运行代码）、精确 Files 路径(`Create:`/`Modify: 路径:行号`/`Test:`)、显式 Interfaces(Consumes/Produces 签名)、命令含预期输出。**绝不**写 AR 式「禁实现细节」——那是反转；这里恰恰 MUST 写出实现。
3. **无占位符·尤其严（写 HOW 节点·TODO/TBD = 失败）**：绝不出现 TBD/TODO/"implement later"/"add appropriate error handling·validation·handle edge cases"/"write tests for the above"(无实际测试代码)/"similar to Task N"(不重贴就要重贴)/只说做什么不给代码/引用任何 task 未定义的类型·函数。**占位 = 直接判失败。**
4. **类型/签名跨 task 一致（对应质量 V2）**：后置 task `Consumes` 用的类型/函数名/签名/属性 == 前置 task `Produces` 定义的（如 Task3 `clearLayers()` 而 Task7 `clearFullLayers()` = bug）——Self-Review 阶段逐 Consumes↔Produces 对照修掉。
5. **spec 全覆盖（对应质量 V4）**：逐条详细设计需求 → 至少一个 task 实现它；Self-Review 列 gap 并补 task。
6. **三关卡任务化（含安全门·对应质量 V5）**：把 B.5.1 编码验证(全测试+构建+lint) / B.5.2 代码评审 / **B.5.3 安全扫描门(MUST 通过)** 列为**实质收尾 task**（不是占位标题）。
7. **安全（重 C-SEC-GATE·生成时即规避·对应质量 V6 veto）**：
   - **不吞没安全相关 Error**——任何 step 不静默 catch/放过安全校验失败。
   - **不用 `--no-verify` / `--no-gpg-sign` 跳门**——commit step 不旁路 git hook；B.5.3 安全门作为 MUST 通过的收尾 gate、无旁路。
8. **Self-Review（写完自查·自己跑、非派子智能体）**：① spec 覆盖逐条 → task；② 占位扫描(§3 红旗)修掉；③ 类型一致(V2)就地修。
9. 〔打回重做时〕先逐条读"已知坑清单"、规避前轮失败模式，再动笔（不是无记忆重来）。

## 落位 + 生成自检（交检查前）
- 写到 `迭代N/vX-<版本>/04-impl/plan.md`。
- 自跑：Plan 头四要素齐 / File Structure 在 / 每 task 五步骨架齐且**代码 step 实质有效非空壳** / **无占位符(TODO/TBD/similar to Task N 扫一遍清零)** / 类型跨 task 一致 / spec 逐条有 task / **三关卡含 B.5.3 安全门成实质 task·安全门未被旁路·无 `--no-verify`**（V5/V6 自查）/ 落对路径。
- **不自调任何检查 SKILL**——准入已过，准出/顶层约束/质量由编排层另触发。

## 红旗（出现即停）
- 改了 writing-plans 骨架 / task 不是最小独立可测单元 / 缺 Files 精确路径或 Interfaces 签名。
- **任何占位**（TODO/TBD/"implement later"/"similar to Task N"/只说做什么不给代码）—— plan 节点占位 = 失败。
- 类型/签名跨 task 不一致（Consumes 引用了 Produces 未定义的名）。
- **吞没安全 Error / 用 `--no-verify` 跳门 / B.5.3 安全门缺失或被旁路**（直接踩 V6 安全 veto）。
- 某详设关键需求无对应 task（踩 V4）。
- 打回重做却不读前轮失败教训（会原地踏步）。
- 喂入不合 `prompt-template` 骨架（缺坐标/上游料/本轮模式，或整改缺教训）——停，退回走准入（输入机检）。
