import { defineStore } from 'pinia'

import { fetchSkills, fetchTemplates } from '../api/templates'
import type { SkillMeta, TemplateMeta } from '../api/templates'

/**
 * 向导 store（L1 员工新建线 Task 13 骨架）：
 * - state: draft（WizardDraft 空初值）/ currentStep（1~7）/ templates / skills；
 * - actions: loadMeta 拉取模板与 skill 全集；selectTemplate(meta|null) 预填 draft（Custom 零预填）
 *   + skills 默认勾选模板自带；gotoStep(n)/next()/prev()（步级必填校验：step2 display 与 id 非空才放行 next）。
 *
 * selectTemplate 预填简化（controller 裁决）：仅取 TemplateMeta 可得字段（display/avatar/id/
 * kind/level/brief），persona 文本域/红线勾选留空态由 Step 组件填；skills 默认勾选 = fetchSkills
 * 结果按 templateId 过滤后映射进 draft.skills（source_type='template'）。
 *
 * 七步语义（spec W1）：① 选择模板 → ② Agent 定义 → ③ Skills → ④ Hooks 与 Tools →
 * ⑤ Commands 与流程 → ⑥ Knowledge（占位「暂未开放」）→ ⑦ Connectors（MCP）。
 */

/** 红线索目（StepHooksTools 勾选态） */
export interface RedlineEntry {
  rule_id: string
  compiled: boolean
}

/** 已选 skill 条目（StepSkills 勾选/上传态） */
export interface DraftSkill {
  name: string
  version: string
  source_type: 'template' | 'local'
  template_id?: string
  origin?: string
  description: string
  /** 草稿恢复场景：local skill 的 zip 文件不可序列化恢复 → 标 true 提示用户重传（F2） */
  needsReupload?: boolean
}

/** 向导草稿（manifest 字段映射 + skills 勾选态） */
export interface WizardDraft {
  // 身份与元数据（StepAgent）
  display: string
  id: string
  idTouched: boolean
  avatar: string
  org: string
  identity: string
  principles: string[]
  /** usage_modes 静默注入（2026-08-28 裁决：UI 移除，按 kind 分派保底值） */
  usage_modes: string[]
  // 模板元
  kind: 'flow-owner' | 'callee' | ''
  level: string
  brief: string
  version: string
  // 红线（StepHooksTools）
  redlines: RedlineEntry[]
  /** 工具白名单（默认全勾；提交时反向构造 deny = 全集 - 已勾） */
  toolsAllowed: string[]
  deny: string[]
  // 管理面（静默注入默认值——2026-08-28 裁决：高级设置 UI 移除）
  tier: string
  tokenPerTask?: number
  tokenMonthly?: number
  governanceLevel: string
  visibility: string
  audit: string
  // 连接器（StepConnectors 只读展示）
  connectors: unknown[]
  // 能力（StepSkills）
  skills: DraftSkill[]
  // 选中模板（null=Custom）
  selectedTemplateId: string | null
}

/**
 * 六步名称（StepBar 渲染）——2026-08-28 对齐 1.0 demo `feat/demo-4stage-flow` /specs/new：
 * 原七步「模板/身份/能力/约束/流程/知识/连接器」重排为「模板/Agent定义/Skills/约束Hook/连接器MCP/其他」，
 * 五轻类（Tools/Hook/知识库/其他）收进 step6 chip 折叠区，不再各占一步。
 */
export const WIZARD_STEPS = ['模板', 'Agent定义', 'Skills', '约束Hook', '连接器MCP', '其他'] as const

/** 工具白名单全集（2026-08-28 裁决：默认全勾，反选进 deny） */
export const ALL_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookEdit',
] as const

/** 空 draft 初值（Custom 起步态） */
function emptyDraft(): WizardDraft {
  return {
    display: '',
    id: '',
    idTouched: false,
    avatar: '',
    org: '',
    identity: '',
    principles: [],
    // 2026-08-28 裁决：UI 移除 usage_modes，静默注入 ['裸用']（kind 分派保底）
    usage_modes: ['裸用'],
    kind: '',
    level: '',
    brief: '',
    version: '',
    redlines: [],
    // 工具白名单默认全勾
    toolsAllowed: [...ALL_TOOLS],
    deny: [],
    // 管理面静默注入默认值（tier/治理/可见性/审计 UI 已移除）
    tier: '编码档',
    governanceLevel: 'L2',
    visibility: 'team',
    audit: 'exceptions-only',
    connectors: [],
    skills: [],
    selectedTemplateId: null,
  }
}

/** 步级必填校验：step2 display 与 id 非空才放行 next；其余步无硬必填 */
function stepCanAdvance(step: number, draft: WizardDraft): boolean {
  if (step === 2) {
    return draft.display.trim() !== '' && draft.id.trim() !== ''
  }
  return true
}

export const useWizardStore = defineStore('wizard', {
  state: () => ({
    draft: emptyDraft() as WizardDraft,
    currentStep: 1 as number,
    templates: [] as TemplateMeta[],
    skills: [] as SkillMeta[],
  }),
  actions: {
    /** 拉取模板与 skill 全集入 state（CreateWizard onMounted 调一次） */
    async loadMeta(): Promise<void> {
      const [tpls, skls] = await Promise.all([fetchTemplates(), fetchSkills()])
      this.templates = tpls
      this.skills = skls
    },

    /**
     * 选中模板：预填 draft（Custom 零预填）+ skills 默认勾选模板自带。
     * meta=null → Custom：draft 重置为空（保留 visibility/audit 默认值）。
     *
     * idTouched 处置：选中模板时 id 来自模板，置 idTouched=true 锁定，避免 StepAgent 的
     * slug 联动 watch 在 display 变化时覆盖模板默认 id（场景：step2 已挂载时点左栏换模板）；
     * Custom 重置时 idTouched=false，让 slug 联动从空态起步跟随 display。
     */
    selectTemplate(meta: TemplateMeta | null): void {
      if (meta === null) {
        const keep = {
          visibility: this.draft.visibility,
          audit: this.draft.audit,
        }
        this.draft = { ...emptyDraft(), ...keep }
        return
      }
      // 重置 draft 但保留模板可得字段 + 模板自带 skills 默认勾选 + idTouched=true 锁定模板 id
      const base = emptyDraft()
      this.draft = {
        ...base,
        selectedTemplateId: meta.id,
        display: meta.display,
        id: meta.id,
        idTouched: true,
        avatar: meta.avatar,
        kind: meta.kind,
        level: meta.level,
        brief: meta.brief,
        skills: this.skills
          .filter((s) => s.templateId === meta.id)
          .map((s) => ({
            name: s.name,
            version: s.version,
            source_type: 'template' as const,
            template_id: s.templateId,
            description: s.description,
          })),
      }
    },

    /** 跳到第 n 步（1~7 范围） */
    gotoStep(n: number): void {
      if (n < 1 || n > WIZARD_STEPS.length) return
      this.currentStep = n
    },

    /** 下一步：步级必填校验通过才放行；已到最后一步返回 false */
    next(): boolean {
      if (this.currentStep >= WIZARD_STEPS.length) return false
      if (!stepCanAdvance(this.currentStep, this.draft)) return false
      this.currentStep += 1
      return true
    },

    /** 上一步：已在第一步返回 false，否则递减 */
    prev(): boolean {
      if (this.currentStep <= 1) return false
      this.currentStep -= 1
      return true
    },
  },
})
