// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
}))

import { fetchSkills, fetchTemplates } from '../src/api/templates'
import PreviewPanel from '../src/components/wizard/PreviewPanel.vue'
import {
  buildManifestFromDraft,
  fieldToStep,
} from '../src/composables/useManifestValidation'
import type { WizardDraft } from '../src/stores/wizard'
import { useWizardStore } from '../src/stores/wizard'

/**
 * PreviewPanel（L1 员工新建线 Task 15）：
 * - buildManifestFromDraft：WizardDraft → manifest 值（schema 形状；固定字段注入）
 * - fieldToStep：path 前段 → step 号（前端简化映射，与 service FIELD_STEP_MAP 同规则，注释互指）
 * - useManifestValidation：watch draft deep → 300ms 防抖 → 校验徽章（绿/红 + issue 列表点击跳转）
 * - 目录树动态显隐：skills 勾选 → `skills/<name>/SKILL.md` 行；redlines 有 compiled → `hooks/hooks.json` 行；
 *   orchestration 需要时 → `orchestration/` 行；commands/knowledge 恒在。
 * - manifest YAML 渲染：js-yaml dump，pre 含 `id:` 等键。
 *
 * 禁词红线：UI 文案不得出现「底座」「安装」「AgentHub」（除完成态显式「安装到底座」动作外）。
 */

function setupStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useWizardStore()
  return { store, pinia }
}

/** schema 兼容的好 draft（中文 usage_modes/tier——与 manifest schema enum 一致） */
function goodDraft(): WizardDraft {
  return {
    display: '前端开发',
    id: 'frontend-dev',
    idTouched: true,
    avatar: '🧑‍💻',
    org: 'local',
    identity: '专注前端界面实现，承接组件开发与页面构建。',
    principles: ['增量交付', '小步迭代'],
    usage_modes: ['裸用'],
    kind: 'flow-owner',
    level: 'L2',
    brief: '前端开发员工',
    version: '0.1.0',
    redlines: [],
    deny: [],
    tier: '编码档',
    governanceLevel: 'L1',
    visibility: 'team',
    audit: 'exceptions-only',
    connectors: [],
    skills: [],
    selectedTemplateId: null,
  }
}

describe('buildManifestFromDraft（draft → manifest 组装）', () => {
  it('好 draft → manifest 含 id/display/version/upp_version/operator/commands/knowledge 等键', () => {
    const m = buildManifestFromDraft(goodDraft()) as Record<string, unknown>
    expect(m['id']).toBe('frontend-dev')
    expect(m['display']).toBe('前端开发')
    expect(m['brief']).toBe('前端开发员工')
    expect(m['version']).toBe('0.1.0')
    expect(m['upp_version']).toBe('2.1')
    expect(m['operator']).toBe('demo@devzero.local')
    expect(m['commands']).toBe('commands/')
    expect(m['knowledge']).toBe('knowledge/')
  })

  it('固定字段注入：agent.persona.role 恒为「数字员工」', () => {
    const m = buildManifestFromDraft(goodDraft()) as Record<string, unknown>
    const agent = m['agent'] as Record<string, unknown>
    const persona = agent['persona'] as Record<string, unknown>
    expect(persona['role']).toBe('数字员工')
  })

  it('skills 映射：勾选清单 → {name,version,source_type,template_id?}', () => {
    const d = goodDraft()
    d.skills = [
      { name: 'tdd-methodology', version: '1.0.0', source_type: 'template', template_id: 'dev-engineer', description: '' },
      { name: 'my-skill', version: '0.1.0', source_type: 'local', origin: 'upload', description: '' },
    ]
    const m = buildManifestFromDraft(d) as Record<string, unknown>
    const skills = m['skills'] as Array<Record<string, unknown>>
    expect(skills.length).toBe(2)
    expect(skills[0]).toMatchObject({ name: 'tdd-methodology', version: '1.0.0', source_type: 'template', template_id: 'dev-engineer' })
    expect(skills[1]).toMatchObject({ name: 'my-skill', version: '0.1.0', source_type: 'local', origin: 'upload' })
  })

  it('usage_modes 含 +编排 + level=L2 + flow-owner → orchestration 存在', () => {
    const d = goodDraft()
    d.usage_modes = ['+编排']
    d.level = 'L2'
    const m = buildManifestFromDraft(d) as Record<string, unknown>
    expect(m['orchestration']).toBeDefined()
  })

  it('usage_modes 不含 +编排 → orchestration 不存在', () => {
    const m = buildManifestFromDraft(goodDraft()) as Record<string, unknown>
    expect(m['orchestration']).toBeUndefined()
  })

  it('kind=callee 即使 usage_modes 含 +编排 也不注入 orchestration（schema R2）', () => {
    const d = goodDraft()
    d.kind = 'callee'
    d.usage_modes = ['+编排']
    const m = buildManifestFromDraft(d) as Record<string, unknown>
    expect(m['orchestration']).toBeUndefined()
  })

  it('org 空时不注入（schema default local 兜底）', () => {
    const d = goodDraft()
    d.org = ''
    const m = buildManifestFromDraft(d) as Record<string, unknown>
    expect(m['org']).toBeUndefined()
  })

  it('tier/token 配额非空时注入 constraints', () => {
    const d = goodDraft()
    d.tier = '编码档'
    d.tokenPerTask = 500000
    d.tokenMonthly = 20000000
    const m = buildManifestFromDraft(d) as Record<string, unknown>
    const constraints = m['constraints'] as Record<string, unknown>
    expect(constraints).toBeDefined()
    expect(constraints['tier']).toBe('编码档')
    const tokenQuota = constraints['token_quota'] as Record<string, unknown>
    expect(tokenQuota['per_task']).toBe(500000)
    expect(tokenQuota['monthly']).toBe(20000000)
  })
})

describe('fieldToStep（path → step 号；前端简化映射）', () => {
  it.each([
    ['display', 2],
    ['id', 2],
    ['org', 2],
    ['operator', 2],
    ['brief', 2],
    ['avatar', 2],
    ['kind', 2],
    ['version', 2],
    ['upp_version', 2],
    ['requires', 2],
    ['requires.level', 2],
    ['agent', 2],
    ['agent.persona.identity', 2],
    ['agent.persona.usage_modes', 2],
    ['skills', 3],
    ['skills.0.name', 3],
    ['hooks', 4],
    ['hooks.redlines', 4],
    ['tools', 4],
    ['tools.deny', 4],
    ['constraints', 4],
    ['constraints.tier', 4],
    ['governance', 4],
    ['governance.level', 4],
    ['orchestration', 5],
    ['orchestration.node_table', 5],
    ['connectors', 7],
    ['connectors.0.command', 7],
    ['unknown', 2],
    ['foobar.baz', 2],
  ])('fieldToStep(%s) → %i', (path, expected) => {
    expect(fieldToStep(path)).toBe(expected)
  })
})

describe('PreviewPanel（防抖 + 校验徽章 + YAML + 目录树）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('防抖：改 draft 后 299ms 不触发，300ms 触发（徽章文本切换）', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    // 让初始 validation 完成
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('校验通过')
    // 改成坏 draft（display 空）
    store.draft.display = ''
    await flushPromises()
    // 299ms 不触发——徽章不显示「失败」
    vi.advanceTimersByTime(299)
    await flushPromises()
    expect(wrapper.text()).not.toContain('失败')
    // 1ms 后到 300ms——触发
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(wrapper.text()).toContain('失败')
  })

  it('坏 draft（display 空）→ 红 + issue 列表 + 点击 emit {step:2, field:"display"}', async () => {
    const { store, pinia } = setupStore()
    const d = goodDraft()
    d.display = ''
    Object.assign(store.draft, d)
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('失败')
    // 展开 issue 列表
    await wrapper.find('[data-role="badge-toggle"]').trigger('click')
    await flushPromises()
    const issues = wrapper.findAll('[data-issue]')
    expect(issues.length).toBeGreaterThan(0)
    // 第一条 issue 应含 display
    expect(issues[0].text()).toContain('display')
    // 点击 issue → emit
    await issues[0].trigger('click')
    const emitted = wrapper.emitted('jump-to-field')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as { step: number; field: string }
    expect(payload.step).toBe(2)
    expect(payload.field).toBe('display')
  })

  it('好 draft → 绿「校验通过」', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('校验通过')
  })

  it('目录树：skills 勾选 → skills/<name>/SKILL.md 行出现', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    store.draft.skills = [
      { name: 'tdd-methodology', version: '1.0.0', source_type: 'template', template_id: 'dev-engineer', description: '' },
    ]
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('skills/tdd-methodology/SKILL.md')
  })

  it('目录树：redlines 有 compiled → hooks/hooks.json 行出现', async () => {
    const { store, pinia } = setupStore()
    const d = goodDraft()
    d.redlines = [{ rule_id: 'no-push-to-main', compiled: true }]
    Object.assign(store.draft, d)
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('hooks/hooks.json')
  })

  it('目录树：commands/knowledge 行恒在', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('commands/')
    expect(wrapper.text()).toContain('knowledge/')
  })

  it('目录树：orchestration 需要时 → orchestration/ 行出现', async () => {
    const { store, pinia } = setupStore()
    const d = goodDraft()
    d.usage_modes = ['+编排']
    d.level = 'L2'
    Object.assign(store.draft, d)
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(wrapper.text()).toContain('orchestration/')
  })

  it('YAML 渲染含 id: display: 等键', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    const yaml = wrapper.find('[data-role="manifest-yaml"]').text()
    expect(yaml).toContain('id:')
    expect(yaml).toContain('display:')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { store, pinia } = setupStore()
    Object.assign(store.draft, goodDraft())
    const wrapper = mount(PreviewPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    vi.advanceTimersByTime(300)
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})
