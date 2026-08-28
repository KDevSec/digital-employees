import { ref, watch, type Ref } from 'vue'
import yaml from 'js-yaml'

import { validateManifest, type ValidationResult } from '@devzero/shared-protocol'
import type { WizardDraft } from '../stores/wizard'

/**
 * useManifestValidation（L1 员工新建线 Task 15）：
 * - buildManifestFromDraft(draft)：WizardDraft → manifest 值（schema 形状；固定字段注入）
 *   调用方：useManifestValidation 内部 + Task 16 api/employees.ts generateEmployee payload 组装（共用同一组装函数）
 * - fieldToStep(path)：path 前段 → step 号（前端简化映射，与 service FIELD_STEP_MAP 同规则，注释互指）
 * - useManifestValidation(source)：watch draft deep → 300ms 防抖 → 组装 manifest → validateManifest
 *   返回 `{ result: Ref<ValidationResult>, pending: Ref<boolean> }`
 * - manifestToYaml(manifest)：js-yaml dump（noRefs + lineWidth 0 紧凑），PreviewPanel YAML 渲染消费
 *
 * 跨字段规则（schema R1/R2）：
 * - R1：usage_modes 含 +编排 ⇒ requires.level 必须 L2 且 orchestration.node_table 必填
 * - R2：kind=callee 不得带 orchestration
 * 本组装函数按 kind/usage_modes 条件包含 orchestration；其余跨字段不一致由 schema safeParse 折成 issue（徽章显示——预期行为）。
 *
 * 禁词：本文件不含 UI 文案，无禁词约束。
 */

/** 固定值注入（非用户编辑字段，schema 形状要求） */
const FIXED = {
  version: '0.1.0',
  upp_version: '2.1',
  operator: 'demo@devzero.local',
  role: '数字员工',
  commands: 'commands/',
  knowledge: 'knowledge/',
} as const

/**
 * path 前段 → step 号（前端简化映射；controller 裁决：display/id/org/operator/brief/avatar/kind/version/
 * upp_version/agent.{x} → 2；skills.{x} → 3；hooks.{x}/tools.{x}/constraints.{x}/governance.{x} → 4；
 * orchestration.{x} → 5；connectors.{x} → 7；未知 → 2）
 *
 * 与 service `workbench-service/src/server/routes/employees.ts` 的 FIELD_STEP_MAP 同规则两处常量
 * （service 用字符串 step 名 / web 用数字 step 号——视图层差异，规则互指）。
 */
const FIELD_STEP_MAP: Record<string, number> = {
  display: 2,
  id: 2,
  org: 2,
  operator: 2,
  brief: 2,
  avatar: 2,
  kind: 2,
  version: 2,
  upp_version: 2,
  requires: 2,
  agent: 2,
  skills: 3,
  hooks: 4,
  tools: 4,
  constraints: 4,
  governance: 4,
  orchestration: 5,
  connectors: 7,
}

/** path → step 号（path 前段映射；未命中默认 2——agent 步覆盖大多数元数据字段） */
export function fieldToStep(path: string): number {
  const first = path.split('.')[0] ?? ''
  return FIELD_STEP_MAP[first] ?? 2
}

/**
 * buildManifestFromDraft：WizardDraft → manifest 值（schema 形状；固定字段注入）。
 *
 * 字段映射：
 * - 固定注入：version（draft 空 → '0.1.0'）/upp_version/operator/agent.persona.role/commands/knowledge
 * - 直传：id/display/brief/avatar/kind/requires.level/agent.persona.{identity,principles,usage_modes}/
 *   hooks.redlines/tools.deny/skills[]/governance.{level,visibility,audit}
 * - 条件包含：org（空时不注入，schema default 'local' 兜底）/constraints（tier 或 token_quota 非空时）/
 *   orchestration（kind=flow-owner 且 usage_modes 含 '+编排' 时）
 * - 默认空：connectors（[]——wizard 当前只读展示，无可编辑连接器）/custom（{}）
 *
 * 注意：空字段直传会让 schema 拒绝（如 display='' 拒 min(1)，kind='' 拒 enum）——这是预期行为，
 * 徽章显示 issue 提示用户补全。组装函数不擅自填默认值，避免掩盖真实校验问题。
 */
export function buildManifestFromDraft(draft: WizardDraft): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    id: draft.id,
    display: draft.display,
    brief: draft.brief,
    avatar: draft.avatar,
    version: draft.version || FIXED.version,
    upp_version: FIXED.upp_version,
    kind: draft.kind,
    operator: FIXED.operator,
    requires: { level: draft.level },
    agent: {
      persona: {
        role: FIXED.role,
        identity: draft.identity,
        principles: draft.principles,
        usage_modes: draft.usage_modes,
      },
    },
    skills: draft.skills.map((s) => {
      const out: Record<string, unknown> = {
        name: s.name,
        version: s.version,
        source_type: s.source_type,
      }
      if (s.template_id !== undefined) out.template_id = s.template_id
      if (s.origin !== undefined) out.origin = s.origin
      return out
    }),
    // 2026-08-31 裁决：权限管理总开关关 → redlines 与 deny 全部不启用（不写入员工包）
    hooks: { redlines: draft.redlinesEnabled ? draft.redlines : [] },
    tools: { deny: draft.redlinesEnabled ? draft.deny : [] },
    commands: FIXED.commands,
    knowledge: FIXED.knowledge,
    connectors: [],
    custom: {},
    governance: {
      level: draft.governanceLevel,
      visibility: draft.visibility,
      audit: draft.audit,
    },
  }

  // org：空时不注入（schema default 'local' 兜底）
  if (draft.org) {
    manifest.org = draft.org
  }

  // constraints：tier 或 token_quota 非空时才注入（schema 整体 default {} 兜底）
  const constraints: Record<string, unknown> = {}
  if (draft.tier) constraints.tier = draft.tier
  if (draft.tokenPerTask !== undefined || draft.tokenMonthly !== undefined) {
    const tokenQuota: Record<string, unknown> = {}
    if (draft.tokenPerTask !== undefined) tokenQuota.per_task = draft.tokenPerTask
    if (draft.tokenMonthly !== undefined) tokenQuota.monthly = draft.tokenMonthly
    constraints.token_quota = tokenQuota
  }
  if (Object.keys(constraints).length > 0) {
    manifest.constraints = constraints
  }

  // orchestration：kind=flow-owner 且 usage_modes 含 '+编排' 时注入（R1/R2 互斥）
  if (draft.kind === 'flow-owner' && draft.usage_modes.includes('+编排')) {
    manifest.orchestration = {
      node_table: `orchestration/${draft.id || 'employee'}.node-table.yml`,
    }
  }

  return manifest
}

/** useManifestValidation 返回结构 */
export interface UseManifestValidationReturn {
  result: Ref<ValidationResult>
  pending: Ref<boolean>
}

/**
 * useManifestValidation：watch draft deep → 300ms 防抖 → 组装 manifest → validateManifest。
 * - 入参 source：WatchSource<WizardDraft>——`() => store.draft` 或 `toRef(store, 'draft')` 均可
 * - result：上一次校验结果（初值 { valid: true, issues: [] }——空 draft 不显示红）
 * - pending：watch 触发到 result 落定期间 true（初始 true——immediate 触发即置位）
 * - 防抖实现：setTimeout 清除重建（测试用 vi.useFakeTimers 验证 299ms 不调 300ms 调）
 */
export function useManifestValidation(
  source: Ref<WizardDraft> | (() => WizardDraft),
): UseManifestValidationReturn {
  const result = ref<ValidationResult>({ valid: true, issues: [] })
  const pending = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(
    source,
    () => {
      pending.value = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const draft = typeof source === 'function' ? source() : source.value
        const manifest = buildManifestFromDraft(draft)
        result.value = validateManifest(manifest)
        pending.value = false
      }, 300)
    },
    { deep: true, immediate: true },
  )

  return { result, pending }
}

/** manifest 值 → YAML 文本（js-yaml dump，noRefs 防循环引用 + lineWidth 0 不换行紧凑） */
export function manifestToYaml(manifest: unknown): string {
  return yaml.dump(manifest, { noRefs: true, lineWidth: 0 })
}
