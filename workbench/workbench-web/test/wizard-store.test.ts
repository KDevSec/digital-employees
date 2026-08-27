// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
}))

import { fetchSkills, fetchTemplates } from '../src/api/templates'
import type { SkillMeta, TemplateMeta } from '../src/api/templates'
import { useWizardStore } from '../src/stores/wizard'

/**
 * wizard store（L1 员工新建线 Task 13 骨架）：
 * - state: draft（WizardDraft 空初值）/ currentStep（1~7）/ templates / skills；
 * - actions: selectTemplate(meta|null) 预填 draft（Custom 零预填）+ skills 默认勾选模板自带；
 *   gotoStep(n)/next()/prev()（步级必填校验：step2 display 与 id 非空才放行 next）。
 *
 * selectTemplate 预填简化（controller 裁决）：仅取 TemplateMeta 可得字段（display/avatar/id/
 * kind/level/brief），persona 文本域/红线勾选留空态由 Step 组件填；skills 默认勾选 = fetchSkills
 * 结果按 templateId 过滤后映射进 draft.skills（source_type='template'）。
 */

const devEngineer: TemplateMeta = {
  id: 'dev-engineer',
  display: '开发工程师',
  brief: '承接需求完成代码实现。',
  avatar: '🧑‍💻',
  kind: 'flow-owner',
  level: 'L2',
  skillsCount: 5,
  builtin: true,
}

const reviewer: TemplateMeta = {
  id: 'reviewer',
  display: '评审专家',
  brief: '被调用者，无自有 flow。',
  avatar: '⚖️',
  kind: 'callee',
  level: 'L2',
  skillsCount: 3,
  builtin: true,
}

const skills: SkillMeta[] = [
  { name: 'tdd-methodology', version: '1.0.0', description: 'TDD 流程', templateId: 'dev-engineer', builtin: true },
  { name: 'secure-coding', version: '1.0.0', description: '安全编码', templateId: 'dev-engineer', builtin: true },
  { name: 'review-verdict', version: '1.0.0', description: '评审裁决', templateId: 'reviewer', builtin: true },
]

describe('useWizardStore（向导 store 骨架）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('初始态：draft 空初值 / currentStep=1 / templates 与 skills 空数组', () => {
    const store = useWizardStore()
    expect(store.currentStep).toBe(1)
    expect(store.templates).toEqual([])
    expect(store.skills).toEqual([])
    expect(store.draft.selectedTemplateId).toBeNull()
    expect(store.draft.display).toBe('')
    expect(store.draft.id).toBe('')
    expect(store.draft.idTouched).toBe(false)
    expect(store.draft.skills).toEqual([])
  })

  it('loadMeta：拉取 templates 与 skills 入 state', async () => {
    vi.mocked(fetchTemplates).mockResolvedValue([devEngineer, reviewer])
    vi.mocked(fetchSkills).mockResolvedValue(skills)
    const store = useWizardStore()
    await store.loadMeta()
    expect(fetchTemplates).toHaveBeenCalledTimes(1)
    expect(fetchSkills).toHaveBeenCalledTimes(1)
    expect(store.templates).toEqual([devEngineer, reviewer])
    expect(store.skills).toEqual(skills)
  })

  it('selectTemplate(meta)：预填 display/avatar/id/kind/level/brief + skills 默认勾选模板自带', () => {
    const store = useWizardStore()
    store.$patch({ skills })
    store.selectTemplate(devEngineer)
    expect(store.draft.selectedTemplateId).toBe('dev-engineer')
    expect(store.draft.display).toBe('开发工程师')
    expect(store.draft.avatar).toBe('🧑‍💻')
    expect(store.draft.id).toBe('dev-engineer')
    expect(store.draft.kind).toBe('flow-owner')
    expect(store.draft.level).toBe('L2')
    expect(store.draft.brief).toBe('承接需求完成代码实现。')
    // skills 默认勾选：dev-engineer 自带的 2 个 skill
    expect(store.draft.skills.map((s) => s.name)).toEqual(['tdd-methodology', 'secure-coding'])
    expect(store.draft.skills.every((s) => s.source_type === 'template')).toBe(true)
  })

  it('selectTemplate(null)：Custom 卡零预填，draft 保持空', () => {
    const store = useWizardStore()
    store.$patch({ skills })
    store.selectTemplate(devEngineer)
    // 切到 Custom
    store.selectTemplate(null)
    expect(store.draft.selectedTemplateId).toBeNull()
    expect(store.draft.display).toBe('')
    expect(store.draft.id).toBe('')
    expect(store.draft.avatar).toBe('')
    expect(store.draft.skills).toEqual([])
  })

  it('gotoStep(n)：currentStep 直接设置（1~7 范围）', () => {
    const store = useWizardStore()
    store.gotoStep(3)
    expect(store.currentStep).toBe(3)
    store.gotoStep(7)
    expect(store.currentStep).toBe(7)
  })

  it('next()：step2 空 display 拦截（步级必填校验）', () => {
    const store = useWizardStore()
    store.gotoStep(2)
    expect(store.draft.display).toBe('')
    expect(store.draft.id).toBe('')
    const result = store.next()
    expect(result).toBe(false)
    expect(store.currentStep).toBe(2) // 未放行
  })

  it('next()：step2 display 与 id 非空放行 → currentStep=3', () => {
    const store = useWizardStore()
    store.gotoStep(2)
    store.draft.display = '前端开发'
    store.draft.id = 'frontend-dev'
    const result = store.next()
    expect(result).toBe(true)
    expect(store.currentStep).toBe(3)
  })

  it('next()：其余步无硬必填直接放行（step3 → 4）', () => {
    const store = useWizardStore()
    store.gotoStep(3)
    const result = store.next()
    expect(result).toBe(true)
    expect(store.currentStep).toBe(4)
  })

  it('next()：已到最后一步（7）不再递增', () => {
    const store = useWizardStore()
    store.gotoStep(7)
    const result = store.next()
    expect(result).toBe(false)
    expect(store.currentStep).toBe(7)
  })

  it('prev()：currentStep 递减，已在第一步不再递减', () => {
    const store = useWizardStore()
    store.gotoStep(3)
    expect(store.prev()).toBe(true)
    expect(store.currentStep).toBe(2)
    expect(store.prev()).toBe(true)
    expect(store.currentStep).toBe(1)
    expect(store.prev()).toBe(false)
    expect(store.currentStep).toBe(1)
  })
})
