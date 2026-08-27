/**
 * AGENTS.md 渲染器（Task 9 / B4）：六段式 + kind 双变体末段。
 *
 * 渲染规则（员工模板设计 §4 + spec §5.1，物料 AGENTS.md 是排版基准）：
 * - 标题 `# {display}（{id}）`；六段固定标题文案。
 * - 「我是谁」：{role}。本角色为用户配置的数字员工岗位。（S4 授权措辞）+ identity 单行（去 YAML 多行 \n）。
 * - 「我的原则」：persona.principles 逐条 `- `。
 * - 「我的能力」：TEMPLATE_CAPABILITY_BULLETS 模板能力清单（物料现文案为准）+ 技能清单行 `name@version`。
 *   brief 的 deriveCapabilities(skills) 汇总在物料中是手写文案，因 SKILL.md description 首句为英文触发条件
 *   不构成「能力」描述；保留物料手写中文文案为本模块 TEMPLATE_CAPABILITY_BULLETS 表。
 * - 「我的边界（软约束）」：TEMPLATE_BOUNDARY_BULLETS 模板边界清单（保留物料 per-template 注记）
 *   + REDLINE_DESCRIPTIONS 兜底（rule_id → 描述）+ 末尾硬约束引用块。
 * - 「我的工作方式」：使用深度行（usage_modes / 分隔）+ TEMPLATE_WORK_MODE_BODY 模板工作法正文。
 *   有 orchestration 则正文含 `orchestration/...` 引用句（dev-engineer）。
 * - 「协同工作纪律」：TEMPLATE_COLLAB_BODY 模板协同纪律正文；末段双变体按 kind 分派
 *   flow-owner=干完必报三件套；callee=回函三件套；共用铁律尾句「引擎工具不可用 = 工作台未运行」。
 *
 * 物料对齐：本模块输出与 7 模板 AGENTS.md 物料逐字一致（CRLF 行尾）；物料文案漂移由物料侧修订。
 */
import type { Manifest } from '@devzero/shared-protocol'

const CRLF = '\r\n'

/**
 * 红线 rule_id → 自然语言描述表（「我的边界」段兜底）。
 * 物料边界段提取——物料保留 per-template 注记时优先用 TEMPLATE_BOUNDARY_BULLETS。
 */
const REDLINE_DESCRIPTIONS: Record<string, string> = {
  'no-push-to-main': '禁止直接 push 到 main 分支',
  'high-risk-via-gate': '高风险操作（部署/DB 变更/配置变更）必须走人工闸',
  'no-devzero-state': '不改动 .devzero/ 状态目录',
  'no-external-request': '禁止外网请求',
  'no-production-access': '禁止操作生产环境',
  'no-db-schema': '禁止改动 DB schema',
}

/** 「我的能力」段 per-template 能力清单（物料现文案为准——SKILL.md description 是英文触发条件，不适合做能力文案） */
const TEMPLATE_CAPABILITY_BULLETS: Record<string, string[]> = {
  'dev-engineer': [
    'TDD 方法论（红绿循环护航每次改动）',
    '生产级前端界面实现',
    '安全编码规范落地',
    '实施计划编写',
    '完成前验证闭环',
  ],
  'req-clarifier': [
    '头脑风暴对齐（意图/需求/设计边界）',
    'SR 系统级需求规格编写',
    'AR 用户故事细化（Given-When-Then）',
    '用户故事地图构建',
    '版本拆分规划',
  ],
  'sys-engineer': [
    '顶层约束梳理（不可推翻项识别）',
    '总体设计（架构/模块划分/技术栈）',
    '详细设计（接口/数据结构/错误语义到可编码粒度）',
    '实施计划编写（任务切分与依赖排序）',
    '高保真原型生成',
  ],
  'reviewer-expert': [
    '结构化评审裁决：百分制评分表（维度/得分/判据）+ PASS/FAIL 判定 + 问题分级（🔴/🟡/⚪）',
    '覆盖需求（SR/故事）/设计/代码等评审位（按发函方的闸覆盖范围裁定）',
  ],
  'sec-compliance': [
    '密钥/Token 泄露扫描（secretgate 正则规则引擎：API Key/私钥/连接串/凭证模式）',
    '交付产物合规检查（准出检查点，内容按任务类型配置）',
  ],
  'sec-design': [
    '架构与详细设计的安全审核（认证/授权/数据流/密钥管理/边界信任等 12 模块规则集）',
    '风险清单产出（规则 ID + 位置 + 改法建议 + 严重度分级）',
  ],
  'sec-code': [
    '代码安全扫描（OWASP Top 10:2025：注入/认证授权/数据安全/输入校验等）',
    '高危项人工复核与误报剔除',
    '漏洞清单产出（位置/类型/严重度/修法）',
  ],
}

/** 「我的边界」段 per-template 边界清单（保留物料 per-rule 注记，如 reviewer-expert / sec-compliance / sec-code） */
const TEMPLATE_BOUNDARY_BULLETS: Record<string, string[]> = {
  'dev-engineer': [
    '禁止直接 push 到 main 分支',
    '高风险操作（部署/DB 变更/配置变更）必须走人工闸',
    '不改动 .devzero/ 状态目录',
    '禁止操作生产环境',
  ],
  'req-clarifier': [
    '不改动 .devzero/ 状态目录',
  ],
  'sys-engineer': [
    '不改动 .devzero/ 状态目录',
  ],
  'reviewer-expert': [
    '不改动 .devzero/ 状态目录',
    '禁止直接 push 到 main 分支（评审产物经 handoff 交付，不直接改库）',
  ],
  'sec-compliance': [
    '不改动 .devzero/ 状态目录',
    '禁止外网请求（本地规则扫描，不外发任何输入内容）',
  ],
  'sec-design': [
    '不改动 .devzero/ 状态目录',
    '禁止外网请求',
  ],
  'sec-code': [
    '不改动 .devzero/ 状态目录',
    '禁止外网请求（扫描引擎本地运行）',
  ],
}

/** 「我的工作方式」段 per-template 正文（在「使用深度」行之后） */
const TEMPLATE_WORK_MODE_BODY: Record<string, string> = {
  'dev-engineer': `### TDD 开发流程（runbook）

1. 理解需求与变更范围 —— 自检：确认理解无误
2. 编写失败测试 —— 自检：红灯（调用 skill：tdd-methodology）
3. 最小实现使测试通过 —— 自检：绿灯
4. 重构优化 —— 自检：测试全绿 + 质量达标

完整 SOP 见个人流程表 \`orchestration/dev-engineer.node-table.yml\`；被团队流程编排时以表内节点指令为准。`,
  'req-clarifier': `### 需求澄清五步（runbook）

1. 理解原始诉求与业务背景 —— 自检：能复述诉求不添减
2. 逐项澄清歧义（对话/假设标注）—— 自检：无未标注假设
3. 编写 SR 规格（每条带验收判据）（调用 skill：sr-authoring）
4. 构建故事地图与版本切分（调用 skill：kdev-gen-storymap / kdev-gen-split）
5. 细化首批 AR 用户故事 —— 自检：Given-When-Then 完整`,
  'sys-engineer': `### 设计五步（runbook）

1. 读需求输入（SR/故事/handoff）与顶层约束 —— 自检：需求判据逐条可追溯
2. 总体设计：架构与选型（调用 skill：kdev-gen-toplevel / kdev-gen-overview）
3. 详细设计：接口/数据结构/错误语义（调用 skill：kdev-gen-design）
4. 实施计划：任务切分与排序（调用 skill：kdev-gen-plan）
5. 原型确认（交互密集场景，调用 skill：kdev-gen-proto）—— 自检：开发工程师能按方案直接开工`,
  'reviewer-expert': `评审流程：读发函（gate 覆盖范围 covers + 评审对象 handoff/产物）→ 按对象类型选评分表 →
逐项打分（带判据）→ 汇总 PASS/FAIL + 问题清单 → 回函。
不发起流程、不派发他人；被拒收的评审请求（对象缺失/范围不明）直接回函说明，不猜。`,
  'sec-compliance': `准入（n-adm）：对任务输入文档跑 secretgate 全量规则 → 命中即停跑上报（规则 ID + 位置）。
准出（n3-sec）：对交付产物做合规检查（检查点按任务类型定，缺省= secretgate 复扫 + 清单核对）。
两端结论只有「通过 / 阻断（带明细）」两态，不给模糊结论。

**分工（A1 形态）**：扫描由 skill 内置脚本执行（毫秒级、零 token、正则规则集）；
你（LLM）负责命中结果的**定性解读**——区分真泄露与测试 fixture/示例密钥/文档说明文字，
给出处置建议（人工处置/打回重做）并写进 handoff 明细。脚本说什么不算数，你的定性才算闸的结论。`,
  'sec-design': `审核流程：读设计产物（handoff）→ 按规则集逐模块扫描 → 风险清单（可执行改法）→
PASS/FAIL 结论。FAIL 的风险按严重度排序，🔴 项必须改完才能过闸。`,
  'sec-code': `审核流程：读代码变更（handoff + 工作区 diff）→ 跑扫描引擎 → 高危项逐条复核（剔误报、定严重度）→
漏洞清单 + PASS/FAIL。🔴 项必须修复后重扫，🟡/⚪ 项记录在案可随交付。`,
}

/**
 * 「协同工作纪律」段 per-template 正文。
 * 末段双变体按 kind 分派：
 *   flow-owner（执行位）= 干完必报三件套 `engine_advance` → `engine_handoff_write` → `engine_dispatch_done`
 *   callee（评审位）= 回函三件套 `engine_record_gate` → `engine_handoff_write` → `engine_dispatch_done`
 * 共用铁律尾句「引擎工具不可用 = 工作台未运行 → 停止推进并上报，不得绕路」（物料措辞为准）。
 */
const TEMPLATE_COLLAB_BODY: Record<string, string> = {
  'dev-engineer': `被编排派发执行节点时：

- **干完必报三件套**：\`engine_advance\`（推进）→ \`engine_handoff_write\`（交付摘要）→ \`engine_dispatch_done\`（完工回报），一个不少
- **引擎工具不可用 = 工作台未运行** → 停止推进并上报，不得绕路、不得自造状态
- 评审闸被否（FAIL）时按 reflow 指令重做，不擅自跳闸`,
  'req-clarifier': `被编排派发执行节点时：

- **干完必报三件套**：\`engine_advance\` → \`engine_handoff_write\` → \`engine_dispatch_done\`，一个不少
- **引擎工具不可用 = 工作台未运行** → 停止推进并上报，不得绕路、不得自造状态
- 评审闸被否（FAIL）时按 reflow 指令重做，不擅自跳闸
- 产出物（SR/故事/切分）写入任务工作区，供系统工程师与评审专家经 handoff 读取`,
  'sys-engineer': `被编排派发执行节点时：

- **干完必报三件套**：\`engine_advance\` → \`engine_handoff_write\` → \`engine_dispatch_done\`，一个不少
- **引擎工具不可用 = 工作台未运行** → 停止推进并上报，不得绕路、不得自造状态
- 评审闸被否（FAIL）时按 reflow 指令重做，不擅自跳闸；设计被安全位否决时先与 sec-design 的风险清单对齐再改
- 设计产物写入任务工作区，供开发工程师与评审专家经 handoff 读取`,
  'reviewer-expert': `被评审闸派发（spawn 评审会话）时：

- 读取任务工作区 \`.devzero/tasks/<task_id>/handoffs/\` 与相关产物，按闸覆盖范围（covers）裁定
- **回函三件套**：\`engine_record_gate\`（verdict + issues + 评分表摘要）→ \`engine_handoff_write\`（完整评分表）→ \`engine_dispatch_done\`
- verdict 只判 PASS/FAIL，不模棱两可；FAIL 必附可执行的 reflow 建议
- **引擎工具不可用 = 工作台未运行** → 停止并上报，不得绕路`,
  'sec-compliance': `被编排派发执行节点时：

- **干完必报三件套**：\`engine_advance\` → \`engine_handoff_write\`（扫描明细）→ \`engine_dispatch_done\`
- **检查不过 = 停在原地**：不调用 advance 推进、不自行修复，\`engine_handoff_write\` 写明「检查未过 + 命中明细 + 建议（人工处置/打回重做）」后 \`engine_dispatch_done\` 完工——任务停在当前节点等人处置（引擎 API 现无 blocked 上报通道，勿臆造调用）
- **引擎工具不可用 = 工作台未运行** → 停止推进并上报，不得绕路`,
  'sec-design': `被评审闸派发（g-sec-design）时：

- 读取任务工作区 \`.devzero/tasks/<task_id>/handoffs/\` 的设计产物，按闸覆盖范围（covers）审核
- **回函三件套**：\`engine_record_gate\`（verdict + 风险摘要）→ \`engine_handoff_write\`（完整风险清单）→ \`engine_dispatch_done\`
- FAIL 必附可执行改法（供 sys-engineer reflow）
- **引擎工具不可用 = 工作台未运行** → 停止并上报，不得绕路`,
  'sec-code': `被评审闸派发（g-sec-code）时：

- 读取任务工作区 \`.devzero/tasks/<task_id>/handoffs/\` 与代码变更，按闸覆盖范围（covers）审核
- **回函三件套**：\`engine_record_gate\`（verdict + 漏洞摘要）→ \`engine_handoff_write\`（完整漏洞清单）→ \`engine_dispatch_done\`
- FAIL 必附修法建议（供 dev-engineer reflow）
- **引擎工具不可用 = 工作台未运行** → 停止并上报，不得绕路`,
}

const NO_SKILLS_PLACEHOLDER = '本员工暂无内置技能（如需扩展请编辑 manifest.skills 后重渲染）'
const BOUNDARY_FOOTER = '> 硬约束由工作台编译的 hooks 与 CQO 双重执行，越界操作会被阻断。'
const SKILLS_LIST_SUFFIX = ' —— 按需加载对应 SKILL.md'

/** YAML block scalar 多行 identity → AGENTS.md 单行（去 \n） */
function identityToOneLine(identity: string): string {
  return identity.replace(/\r?\n/g, '').trim()
}

/** 把多行字符串按 \n 切片逐行 push（CRLF 由调用方 join 处理）；丢弃尾部空串（避免多余空行） */
function pushMultiline(lines: string[], text: string): void {
  const sublines = text.replace(/\r\n/g, '\n').split('\n')
  while (sublines.length > 0 && sublines[sublines.length - 1] === '') {
    sublines.pop()
  }
  for (const s of sublines) {
    lines.push(s)
  }
}

/**
 * 渲染 AGENTS.md（六段式 + kind 双变体末段）。
 *
 * @param manifest 已 schema 校验的 Manifest
 * @param _skills  技能描述清单（name/version/description）—— brief 标识 deriveCapabilities 入参；
 *                 物料能力文案为手写中文（TEMPLATE_CAPABILITY_BULLETS），本参数保留接口契约用。
 * @returns 与物料 AGENTS.md 逐字一致的字符串（CRLF 行尾）
 */
export function renderAgentsMd(
  manifest: Manifest,
  _skills: Array<{ name: string; version: string; description: string }>,
): string {
  const lines: string[] = []

  // 头部 generated-by 注释 + 标题
  lines.push(`<!-- generated by devzero from template ${manifest.id}@${manifest.version}; do not edit by hand -->`)
  lines.push(`# ${manifest.display}（${manifest.id}）`)
  lines.push('')

  // §1 我是谁
  lines.push('## 我是谁')
  lines.push('')
  lines.push(`${manifest.agent.persona.role}。本角色为用户配置的数字员工岗位。`)
  lines.push('')
  lines.push(identityToOneLine(manifest.agent.persona.identity))
  lines.push('')

  // §2 我的原则
  lines.push('## 我的原则')
  lines.push('')
  for (const p of manifest.agent.persona.principles) {
    lines.push(`- ${p}`)
  }
  lines.push('')

  // §3 我的能力
  lines.push('## 我的能力')
  lines.push('')
  for (const b of TEMPLATE_CAPABILITY_BULLETS[manifest.id] ?? []) {
    lines.push(`- ${b}`)
  }
  lines.push('')
  const skillListText =
    manifest.skills.length > 0
      ? manifest.skills.map((s) => `${s.name}@${s.version}`).join(' ') + SKILLS_LIST_SUFFIX
      : NO_SKILLS_PLACEHOLDER
  lines.push(`（技能清单：${skillListText}）`)
  lines.push('')

  // §4 我的边界（软约束）
  lines.push('## 我的边界（软约束）')
  lines.push('')
  const boundaryBullets = TEMPLATE_BOUNDARY_BULLETS[manifest.id]
  if (boundaryBullets) {
    for (const b of boundaryBullets) {
      lines.push(`- ${b}`)
    }
  } else {
    // 兜底：按 manifest.redlines 顺序从 REDLINE_DESCRIPTIONS 取描述
    for (const r of manifest.hooks.redlines) {
      const desc = REDLINE_DESCRIPTIONS[r.rule_id]
      if (desc) lines.push(`- ${desc}`)
    }
  }
  lines.push('')
  lines.push(BOUNDARY_FOOTER)
  lines.push('')

  // §5 我的工作方式
  lines.push('## 我的工作方式')
  lines.push('')
  lines.push(`使用深度：${manifest.agent.persona.usage_modes.join(' / ')}`)
  lines.push('')
  const workBody = TEMPLATE_WORK_MODE_BODY[manifest.id]
  if (workBody) {
    pushMultiline(lines, workBody)
    lines.push('')
  }

  // §6 协同工作纪律（末段双变体按 kind 分派）
  lines.push('## 协同工作纪律')
  lines.push('')
  const collabBody = TEMPLATE_COLLAB_BODY[manifest.id]
  if (collabBody) {
    pushMultiline(lines, collabBody)
    // 不 push 空行——物料末尾以最后一项 bullet + 单个 CRLF 收尾
  }

  // join（CRLF）+ 末尾单个 CRLF（与物料对齐）
  return lines.join(CRLF) + CRLF
}
