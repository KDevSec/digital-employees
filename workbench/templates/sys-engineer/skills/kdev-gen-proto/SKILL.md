---
name: kdev-gen-proto
description: 高保真原型节点的产物生成 SKILL（V4x.1·从原型生成提示词模板转化·delegate:frontend-design 模式·非 author）——承接本版本 AR + profile 设计系统硬约束，委托 frontend-design skill 创作高保真原型。承接 Agent 不代笔、不规定 frontend-design 内部方法、不自评。内嵌 C-UED NON-NEGOTIABLE（禁裸 hex/px/未授权字体）、覆盖 AR 全集关键交互与状态态、SHOULD 附交互点↔AC 追溯表、MUST 配走查 README。打回重做时把前轮失败教训随委托转交。料（AR+设计系统硬约束+坐标[+前轮教训]）由生成提示词喂入。Use when 准入 pass 后生成/整改/重做原型产物（与 AR 同组）。
---

<!-- devzero 物化：源自 1.0 仓 plugins/agents-team/skills/kdev-gen-proto（2026-08-27，devzero 化改写） -->

# kdev-gen-proto · 高保真原型生成（delegate:frontend-design·从原型生成提示词模板转化）

> **跨技能依赖声明（V0.1）**：本 skill 的方法论 = 委托 `frontend-design` 技能创作原型（该技能默认配置在
> dev-engineer 员工包）。若当前员工包未包含 frontend-design（D-006 包自包含原则下的显式可选依赖），
> **降级语义**：由承接者自含产出基础结构原型（布局/信息层级/交互清单，不含高保真视觉），
> 并在产物头部注明「基础档（无 frontend-design 技能）」；不得假装已完成高保真创作。

**开场播报**："我在用 kdev-gen-proto 承接 <版本> 高保真原型生成（delegate:frontend-design 模式）。"

> **V4x.1 形态**：本 SKILL 把"承接动作 + 委托纪律 + 交付硬标准"封装成可调承接器。`0b-生成提示词模板-原型` 因此变薄——只喂坐标+AR+设计系统硬约束并**调本 SKILL**，不再贴整段委托指令。
> **节点特殊性 · delegate 非 author**：原型是**创作型产物**，生成方式 = **delegate:frontend-design**。你是承接者（**不是原型作者本人**）——**不 author 填章节、不自造生成规范、不规定 frontend-design 的内部选型/排版/组件化方法、不自评**。你只做两件事：①把"本版本 AR + profile 设计系统硬约束"装配为委托输入并委托 `frontend-design` 创作；②产物落位。

## 吃什么（生成提示词喂入）
> **输入骨架与必填字段以 `nodes-data/proto/prompt-template.md` 为准（占位模板+机检参数单一真源·准入 `prompt-check.sh` 依它核）；本段只述各料语义。**
- 坐标：迭代 / 版本（vX-名）/ 落位 `迭代N/vX-版本/02-prototype/`。与 AR **同组**生成、同组联合评审。
- 本轮模式：首次生成 / 整改第K轮 / 打回重做。
- **承接的上游产物**：
  - 本版本 AR 需求 <<AR_PATH>>——覆盖各需求卡的关键交互与状态态，**这是原型必须呈现的全集**，整体转交 frontend-design 作委托输入。
- **profile 设计系统硬约束**（C-UED · NON-NEGOTIABLE·转交 frontend-design 作硬约束·不可协商）：<<设计系统/design-tokens 指针，如 design-tokens.json / tailwind.preset.js / ued-v6.css>>
  - 硬约束语义：**禁裸 hex / 禁裸 px / 禁未授权字体**（一律走 token）；交互语义遵守设计系统（权限可见性 / 置灰气泡 / 确认文案 / 长任务异步）。
- 〔打回重做/整改 时 MUST 含〕前轮合并便签的 **veto 失败项 + 主要扣分点**（已知坑清单，如"某 AC 无对应呈现致互证悬空""出现裸 hex""漏状态态"），随委托一并转交 frontend-design。

## 承接 + 委托（delegate·MUST·不代笔）
1. **委托而非代笔**：以 `frontend-design` skill 生成原型；承接 Agent **不替它写设计、不规定其内部步骤、不改其产物形态**。你只交付「AR 全集 + 设计系统硬约束 + 落位」三件，不下指令规定其内部方法。
2. **C-UED 合规（NON-NEGOTIABLE）**：交付物**无裸 hex / 无裸 px / 无未授权字体**，颜色·间距·字体一律走设计系统 token；交互语义遵守设计系统约定。作为转交 frontend-design 的硬性交付标准下达。
3. **覆盖 AR 全集**：原型须覆盖本版本 AR **各需求卡的关键交互**与**状态态**（空数据 / 加载 / 错误态保留表头、列表分页 / 排序 / 面包屑等适用项），不引入无 user story 支撑的凭空交互。
4. **追溯表（SHOULD）**：原型 **SHOULD** 附"**交互点 ↔ AC ID 追溯表**"——逐个交互点映射其对应 AR 的 AC ID，为后续 AR↔原型互证 veto（PV1）留机检锚点。附了→准出 PT6 可逐行机检勾核大幅降漏判；未附→评审仅能语义互证且便签 MUST 标"无追溯表·漏判风险高"。
5. **配走查 README（MUST）**：附走查 README——声明可本地起、走查路径完整、关键交互与状态态走查入口清晰。
6. 〔打回重做时〕把"已知坑清单"随委托转交 frontend-design、明确规避前轮失败模式，再发起生成（不是无记忆重来）。

## 落位 + 生成自检（交检查前）
- frontend-design 产物写到 `迭代N/vX-版本/02-prototype/`。
- 自跑：覆盖 AR 各卡关键交互与状态态 / 无裸 hex·px·未授权字体（走 token）/ 追溯表已附（或便签已标"无追溯表·漏判风险高"）/ 走查 README 齐且可本地起 / 落对路径 / 评审组两件（AR+原型）就绪。
- **不自调任何检查 SKILL**——准入已过，准出/顶层约束/质量（含 AR↔原型互证 veto）由编排层另触发。

## 红旗（出现即停）
- **承接 Agent 自己 author 写章节 / 规定 frontend-design 内部方法 / 自造生成规范**（delegate 形态被误写成 author）。
- 出现裸 hex / 裸 px / 未授权字体（违反 C-UED NON-NEGOTIABLE）。
- 引入无 user story 支撑的凭空交互，或漏覆盖 AR 关键 AC / 状态态。
- 漏走查 README。
- 打回重做却不把前轮失败教训转交 frontend-design（会原地踏步）。
- 喂入不合 `prompt-template` 骨架（缺坐标/上游料/本轮模式，或整改缺教训）——停，退回走准入（输入机检）。
