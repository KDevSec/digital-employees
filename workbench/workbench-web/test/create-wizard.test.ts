// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
}))

import { fetchSkills, fetchTemplates } from '../src/api/templates'
import type { SkillMeta, TemplateMeta } from '../src/api/templates'
import CreateWizard from '../src/views/CreateWizard.vue'
import { useWizardStore } from '../src/stores/wizard'

/**
 * CreateWizard 骨架（L1 员工新建线 Task 13）：
 * - page-head（← 返回按钮 → /employees + h1「员工创建」+ 副标）
 * - layout-2col：左栏「1 · 选择角色模板」+ TplGrid；「2 · 配置向导」卡（StepBar + 步骤区 + 上一步/下一步）
 * - 右栏 sticky 预览面板占位（「产出物预览」文案，Task 15 实做）
 * - 模板卡 8 张（7 模板 + Custom）；点模板卡 → store.selectTemplate(meta) + draft 预填 + skills 默认勾选
 * - StepBar 七步点击 goto；下一步步级必填校验（step2 空 display 拦）
 * - 禁词红线：UI 文案不得出现「底座」「安装」「AgentHub」
 *
 * 测试隔离：每个 mount 自带 pinia + memory router（不依赖全局 router 单例）；
 * fetch 以模块 mock 顶替（组件挂载时 store.loadMeta 调一次拉取模板与 skill 全集）。
 */

const templates: TemplateMeta[] = [
  { id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现。', avatar: '🧑‍💻', kind: 'flow-owner', level: 'L2', skillsCount: 5, builtin: true },
  { id: 'req-architect', display: '需求架构师', brief: '需求结构化与架构设计。', avatar: '🧑‍🔬', kind: 'flow-owner', level: 'L2', skillsCount: 6, builtin: true },
  { id: 'test-engineer', display: '测试工程师', brief: '测试设计与质量守护。', avatar: '🧑‍🔬', kind: 'flow-owner', level: 'L2', skillsCount: 5, builtin: true },
  { id: 'reviewer', display: '评审专家', brief: '被调用者，无自有 flow。', avatar: '⚖️', kind: 'callee', level: 'L2', skillsCount: 3, builtin: true },
  { id: 'researcher', display: '调研员', brief: '技术/领域/市场调研。', avatar: '🕵️', kind: 'flow-owner', level: 'L2', skillsCount: 4, builtin: true },
  { id: 'brainstorming-coach', display: '头脑风暴教练', brief: '引导式头脑风暴。', avatar: '🧙', kind: 'callee', level: 'L2', skillsCount: 2, builtin: true },
  { id: 'presentation-master', display: '演示大师', brief: '视觉传达与演讲。', avatar: '🧑‍🎨', kind: 'callee', level: 'L2', skillsCount: 3, builtin: true },
]

const skills: SkillMeta[] = [
  { name: 'tdd-methodology', version: '1.0.0', description: 'TDD 流程', templateId: 'dev-engineer', builtin: true },
  { name: 'review-verdict', version: '1.0.0', description: '评审裁决', templateId: 'reviewer', builtin: true },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/employees', component: { template: '<div/>' } }],
  })
}

async function mountWizard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  vi.mocked(fetchTemplates).mockResolvedValue(templates)
  vi.mocked(fetchSkills).mockResolvedValue(skills)
  const wrapper = mount(CreateWizard, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, store: useWizardStore(), router }
}

describe('CreateWizard 骨架渲染', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('page-head：返回按钮 + 「员工创建」标题 + 副标', async () => {
    const { wrapper } = await mountWizard()
    const text = wrapper.text()
    expect(text).toContain('员工创建')
    expect(wrapper.find('button.back-btn').exists()).toBe(true)
  })

  it('左栏「1 · 选择角色模板」+ 「2 · 配置向导」两段标题在位', async () => {
    const { wrapper } = await mountWizard()
    const text = wrapper.text()
    expect(text).toContain('1 · 选择角色模板')
    expect(text).toContain('2 · 配置向导')
  })

  it('TplGrid 渲染 8 张卡（7 模板 + Custom）', async () => {
    const { wrapper } = await mountWizard()
    const cards = wrapper.findAll('.tpl-card')
    expect(cards.length).toBe(8)
    // 7 模板卡 + 1 Custom 卡
    expect(wrapper.text()).toContain('开发工程师')
    expect(wrapper.text()).toContain('Custom')
  })

  it('模板卡含 tpl-name / kind tag / brief / id / 使用模板链接', async () => {
    const { wrapper } = await mountWizard()
    const card = wrapper.findAll('.tpl-card').find((c) => c.text().includes('开发工程师'))
    expect(card, '开发工程师卡应存在').toBeTruthy()
    const cardText = card!.text()
    expect(cardText).toContain('dev-engineer')
    expect(cardText).toContain('flow-owner')
    expect(cardText).toContain('承接需求完成代码实现。')
    expect(cardText).toContain('使用模板')
  })

  it('右栏预览面板占位「产出物预览」', async () => {
    const { wrapper } = await mountWizard()
    expect(wrapper.text()).toContain('产出物预览')
  })
})

describe('CreateWizard 模板选中与 draft 预填', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('点模板卡 → store.selectedTemplateId 变更 + draft.display 预填 + skills 默认勾选', async () => {
    const { wrapper, store } = await mountWizard()
    const card = wrapper.findAll('.tpl-card').find((c) => c.text().includes('开发工程师'))
    await card!.trigger('click')
    expect(store.draft.selectedTemplateId).toBe('dev-engineer')
    expect(store.draft.display).toBe('开发工程师')
    expect(store.draft.skills.map((s) => s.name)).toEqual(['tdd-methodology'])
    // 选中态视觉：卡带 selected 类或 ✓ 标记
    expect(card!.classes()).toContain('selected')
  })

  it('点 Custom 卡 → draft 保持空（零预填）', async () => {
    const { wrapper, store } = await mountWizard()
    const customCard = wrapper.findAll('.tpl-card').find((c) => c.text().includes('Custom'))
    await customCard!.trigger('click')
    expect(store.draft.selectedTemplateId).toBeNull()
    expect(store.draft.display).toBe('')
    expect(store.draft.skills).toEqual([])
  })

  it('切换模板：先选开发工程师再选评审专家 → draft 跟到评审专家', async () => {
    const { wrapper, store } = await mountWizard()
    const devCard = wrapper.findAll('.tpl-card').find((c) => c.text().includes('开发工程师'))
    await devCard!.trigger('click')
    expect(store.draft.selectedTemplateId).toBe('dev-engineer')
    const reviewerCard = wrapper.findAll('.tpl-card').find((c) => c.text().includes('评审专家'))
    await reviewerCard!.trigger('click')
    expect(store.draft.selectedTemplateId).toBe('reviewer')
    expect(store.draft.display).toBe('评审专家')
  })
})

describe('CreateWizard 步骤条与下一步校验', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('StepBar 渲染六步名称（demo 对齐）', async () => {
    const { wrapper } = await mountWizard()
    const steps = wrapper.findAll('.step')
    expect(steps.length).toBe(6)
    const text = wrapper.text()
    // 六步名称（2026-08-28 demo 对齐）：模板/Agent定义/Skills/约束Hook/连接器MCP/其他
    expect(text).toContain('模板')
    expect(text).toContain('Agent定义')
    expect(text).toContain('Skills')
    expect(text).toContain('约束Hook')
    expect(text).toContain('连接器MCP')
    expect(text).toContain('其他')
  })

  it('StepBar 点击步骤 → currentStep 切换', async () => {
    const { wrapper, store } = await mountWizard()
    const steps = wrapper.findAll('.step')
    expect(store.currentStep).toBe(1)
    await steps[2].trigger('click') // 点第 3 步「能力」
    expect(store.currentStep).toBe(3)
  })

  it('下一步按钮：step1 无必填直接放行到 step2', async () => {
    const { wrapper, store } = await mountWizard()
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    expect(nextBtn, '下一步按钮应存在').toBeTruthy()
    await nextBtn!.trigger('click')
    expect(store.currentStep).toBe(2)
  })

  it('下一步按钮：step2 空 display 拦截（步级必填校验）', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(2)
    await flushPromises()
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    await nextBtn!.trigger('click')
    expect(store.currentStep).toBe(2) // 拦截
  })

  it('下一步按钮：step2 display 与 id 非空放行', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(2)
    store.draft.display = '前端开发'
    store.draft.id = 'frontend-dev'
    await flushPromises()
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    await nextBtn!.trigger('click')
    expect(store.currentStep).toBe(3)
  })

  it('上一步按钮：currentStep 递减', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(3)
    await flushPromises()
    const prevBtn = wrapper.findAll('button').find((b) => b.text().includes('上一步'))
    await prevBtn!.trigger('click')
    expect(store.currentStep).toBe(2)
  })
})

describe('CreateWizard 禁词红线（Global Constraint）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('UI 文案不得出现「底座」「安装」「AgentHub」', async () => {
    const { wrapper } = await mountWizard()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('CreateWizard unmount flush（F4）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('unmount 时立即落键——draft 变更后 ≤1s 内 unmount 不丢最后一段编辑', async () => {
    vi.useFakeTimers()
    const { wrapper, store } = await mountWizard()
    // 改 draft 触发 watch → saveDraft 设置 1s 防抖 timer（尚未落键）
    store.draft.display = '前端开发'
    await wrapper.vm.$nextTick()
    expect(localStorage.getItem('devzero:wizard-draft')).toBeNull()
    // unmount → flushDraft 立即落键
    wrapper.unmount()
    expect(localStorage.getItem('devzero:wizard-draft')).not.toBeNull()
    const raw = localStorage.getItem('devzero:wizard-draft')
    expect(raw).toContain('前端开发')
    vi.useRealTimers()
  })
})
