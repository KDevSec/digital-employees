# 员工模板库（E-11 · 七员工内置模板）

> 员工创建向导的预填素材源，兼内置 team 的预置员工物化源。**模板 = 一份完整的示例员工包**（与员工包同构，零新概念）。
> 结构规范唯一源：[员工模板设计](../../docs/plans/2026-08-26-员工模板-design.md)（决策 T1~T11）；schema：[shared-protocol v0.2](../../docs/design/详细设计/shared-protocol详细设计-v0.2.md)（八类顶层）。

## 模板清单

| 目录 | display | avatar | kind | level | skills |
|------|---------|--------|------|-------|--------|
| `dev-engineer/` | 开发工程师 | 🧑‍💻 | flow-owner | L2 | 5 份（tdd-methodology 等） |
| `req-clarifier/` | 需求澄清师 | 🧑‍🏫 | flow-owner | L1 | 5 份（brainstorming/sr/ar/kdev-gen-storymap/split） |
| `sys-engineer/` | 系统工程师 | 🧑‍🔬 | flow-owner | L1 | 5 份（kdev-gen-toplevel 等） |
| `reviewer-expert/` | 评审专家 | ⚖️ | **callee** | L1 | 1 份（review-verdict，新写） |
| `sec-compliance/` | 安全合规审核员 | 🕵️ | flow-owner | L1 | L1 实施批补（secretgate TS 移植） |
| `sec-design/` | 安全设计审核员 | 🧙 | flow-owner | L1 | L1 实施批补（sec-scan-design zip） |
| `sec-code/` | 代码安全审核员 | 🦾 | flow-owner | L1 | L1 实施批补（sec-scan-code zip） |

另有 `skills-remaining.md`（物料批次台账）。Custom 白纸 = 无目录零预填。

## 每个模板的目录结构

```
<emp-id>/
├── manifest.yml          # 八类 v0.2：元数据 10 项 + 八件套（1+7）+ 管理面 3 段
├── AGENTS.md             # 六段式默认渲染产物（唯一身份/指令源）
├── skills/<skill>/       # skill 素材（SKILL.md + 副文件；快照拷贝源）
├── hooks/hooks.json      # 红线声明编译产物（勿手改）
├── commands/  knowledge/ # ⑤⑥ 预留空目录（V0.1）
└── orchestration/        # 仅 dev-engineer：个人 SOP 表（8 节点 TDD 循环）
```

connectors 为空时不生成 mcp.json（约定：字段空 = 件不存在）。

## 消费方式（两条路，同一 E-12 管线）

- **向导**：Step 1 读模板元字段渲染卡片 → 选中预填 draft → 用户改 → 管线**按 draft 重建**（非复制模板后改）
- **预置物化**（内置 team 吃狗粮）：首启初始化把 7 模板逐个走同一管线物化进 `~/.devzero/employees/`，operator 填占位 `demo@devzero.local`

快照语义：生成的员工定格当时的模板版本，模板升级不追改已生成员工。

## AGENTS.md 六段式（渲染双变体）

我是谁 / 我的原则 / 我的能力 / 我的边界 / 我的工作方式 / **协同工作纪律**——末段按 kind 分派：

- **执行位**（action 派发）：干完必报三件套 `engine_advance` → `engine_handoff_write` → `engine_dispatch_done`
- **评审位**（gate 派发）：回函三件套 `engine_record_gate` → `engine_handoff_write` → `engine_dispatch_done`
- 共用铁律：引擎工具不可用 = 工作台未运行 → 停止推进并上报，不得绕路

## 修改纪律

1. **manifest 改动须过 v0.2 schema**（zod 真源落仓后 CI 强制校验本目录 7 份）
2. **三方互证**：manifest ↔ AGENTS.md ↔ hooks.json 保持一致——改 persona 要同步 AGENTS，改红线要重新编译 hooks.json（hooks.json 是产物，勿手改）
3. **tier 与红线分配已定格**（T10 裁决 2026-08-27）；token 配额与治理默认值为演示默认值（Q-T4 余项留口子，向导可改）
4. 个人表 `reviewer: self` = 驻留员工自评闸（不 spawn）——个人表专属语义，团队表 reviewer 必须是员工 id
5. sec 三员 manifest 的 `skills: []` 为对账状态（声明-实物一致优先），L1 实施批补齐素材后恢复条目
6. 新增模板：复制同构目录 + 过 schema + AGENTS 六段式渲染一致；kind 判据 = 能否裸用独立完成全部职责（只能服务评审闸者 = callee，无 orchestration/）

