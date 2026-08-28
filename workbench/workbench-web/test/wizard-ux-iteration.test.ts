// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
}))
vi.mock('../src/api/employees', () => ({
  fetchEmployees: vi.fn(),
  generateEmployee: vi.fn(),
  saveAsTemplate: vi.fn(),
  validateId: vi.fn(),
}))

import { fetchSkills, fetchTemplates } from '../src/api/templates'
import { fetchEmployees, generateEmployee, saveAsTemplate } from '../src/api/employees'
import type { SkillMeta, TemplateMeta } from '../src/api/templates'
import type { EmployeeCard } from '../src/api/employees'
import CreateWizard from '../src/views/CreateWizard.vue'
import EmployeesView from '../src/views/EmployeesView.vue'
import { useWizardStore } from '../src/stores/wizard'

/**
 * 向导 UX 迭代（2026-08-28 用户裁决）：
 * 1. StepAgent 删「使用深度」UI；draft 静默注入 usage_modes=['裸用']（kind 分派：callee 保底裸用）
 * 2. StepHooksTools 删「高级设置」整段（tier/token/可见性/审计/治理级别）；
 *    红线描述改为「主描述 + 括号举例」；新增工具白名单（默认全勾，反选进 deny）
 * 3. CreateWizard：TplGrid 移入 step1 区域（不再常驻上方）
 * 4. EmployeesView：只显示已安装员工（hosts.length>0），卡片带底座徽章行
 * 5. CompletionPanel：generate 200 后自动 saveAsTemplate（模板池 a 方案）
 * 6. 后端：GET /api/employees 返回卡片扩展 hosts: string[]（installs registry 聚合）
 */

const templates: TemplateMeta[] = [
  { id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现。', avatar: '🧑‍💻', kind: 'flow-owner', level: 'L2', skillsCount: 5, builtin: true },
  { id: 'reviewer-expert', display: '评审专家', brief: '被调用者，无自有 flow。', avatar: '⚖️', kind: 'callee', level: 'L2', skillsCount: 3, builtin: true },
]

const skills: SkillMeta[] = [
  { name: 'tdd-methodology', version: '1.0.0', description: 'TDD 流程', templateId: 'dev-engineer', builtin: true },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/employees', component: { template: '<div/>' } },
      { path: '/employees/new', component: CreateWizard },
    ],
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

describe('StepAgent — 移除「使用深度」UI + usage_modes 静默注入', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('StepAgent 渲染中无「使用深度」字样', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(2)
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('使用深度')
    expect(text).not.toContain('裸用（直接对话）')
    expect(text).not.toContain('+方法论（skill 调用序列）')
  })

  it('Custom 起步：draft.usage_modes 静默注入 [裸用]', async () => {
    const { store } = await mountWizard()
    store.selectTemplate(null)
    expect(store.draft.usage_modes).toEqual(['裸用'])
  })

  it('callee 模板：draft.usage_modes 静默注入 [裸用]（schema R2 安全）', async () => {
    const { store } = await mountWizard()
    store.selectTemplate(templates[1]) // reviewer-expert callee
    expect(store.draft.kind).toBe('callee')
    expect(store.draft.usage_modes).toEqual(['裸用'])
  })

  it('flow-owner 模板：draft.usage_modes 保留模板原值（模板覆盖静默注入）', async () => {
    const { store } = await mountWizard()
    // dev-engineer 模板 manifest 里 usage_modes=[裸用, +方法论, +流程, +编排]
    // 但 TemplateMeta 不含 usage_modes 字段——当前 selectTemplate 只取 meta 可得字段
    // 所以 flow-owner 模板也走静默注入 [裸用]，避免 R1 校验失败（L1 模板不能 +编排）
    store.selectTemplate(templates[0])
    expect(store.draft.kind).toBe('flow-owner')
    expect(store.draft.usage_modes).toEqual(['裸用'])
  })
})

describe('StepHooksTools — 删高级设置 + 红线新描述 + 工具白名单', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('StepHooksTools 渲染中无「高级设置」/「模型档位」/「Token」/「可见范围」/「审计级别」/「治理级别」', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(4)
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('高级设置')
    expect(text).not.toContain('模型档位')
    expect(text).not.toContain('Token')
    expect(text).not.toContain('可见范围')
    expect(text).not.toContain('审计级别')
    expect(text).not.toContain('治理级别')
  })

  it('红线描述含括号举例（如 git push origin main / master）', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(4)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('禁止直接推送到主分支（如 git push origin main / master）')
    expect(text).toContain('危险操作必须经人工确认（如 rm -rf、删除文件夹、修改系统配置）')
    expect(text).toContain('禁止修改运行时状态文件（如 .devzero/ 目录下任何文件）')
    expect(text).toContain('禁止访问外网（如 curl / wget / 任何 HTTP 请求外部站点）')
    expect(text).toContain('禁止访问生产环境（如 prod 域名/IP、/etc/prod/ 路径）')
    expect(text).toContain('禁止修改数据库结构（如 ALTER TABLE、DROP TABLE、CREATE INDEX）')
    expect(text).toContain('自定义红线规则（暂未开放）')
  })

  it('工具黑名单：默认无禁用（deny 为空）', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(4)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('工具黑名单')
    expect(text).toContain('Bash')
    expect(text).toContain('Read')
    expect(text).toContain('Write')
    expect(text).toContain('Edit')
    expect(text).toContain('Glob')
    expect(text).toContain('Grep')
    expect(text).toContain('WebFetch')
    expect(text).toContain('WebSearch')
    expect(text).toContain('TodoWrite')
    expect(text).toContain('NotebookEdit')
    // 默认无禁用
    expect(store.draft.deny).toEqual([])
    expect(store.draft.toolsAllowed).toEqual([
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
      'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookEdit',
    ])
  })

  it('工具黑名单：勾选 → deny 追加该工具（反向语义）', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(4)
    await flushPromises()
    // 勾选 Bash = 禁用 Bash
    const bashChip = wrapper.findAll('[data-tool]').find((c) => c.text().includes('Bash'))
    await bashChip!.trigger('click')
    expect(store.draft.deny).toContain('Bash')
    expect(store.draft.deny).not.toContain('Read')
    // deny-preview 更新
    expect(wrapper.text()).toContain('已禁 1 个')
  })

  it('权限管理总开关：总关 → redlines 与 deny 全部不启用（不写入员工包）', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(4)
    await flushPromises()
    // 默认总开
    expect(store.draft.redlinesEnabled).toBe(true)
    expect(wrapper.text()).toContain('已启用')
    // 关闭总开关
    const masterToggle = wrapper.find('[data-role="redlines-master"]')
    await masterToggle.setValue(false)
    expect(store.draft.redlinesEnabled).toBe(false)
    expect(wrapper.text()).toContain('已停用')
    // manifest 组装：redlines 与 deny 全部为空
    const { buildManifestFromDraft } = await import('../src/composables/useManifestValidation')
    const manifest = buildManifestFromDraft(store.draft)
    expect((manifest.hooks as Record<string, unknown>).redlines).toEqual([])
    expect((manifest.tools as Record<string, unknown>).deny).toEqual([])
  })
})

describe('CreateWizard — TplGrid 移入 step1 区域', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('step1 时 TplGrid 在 step 区域显示（不再常驻上方）', async () => {
    const { wrapper, store } = await mountWizard()
    // step1 默认
    expect(store.currentStep).toBe(1)
    const tplGrid = wrapper.find('.tpl-grid')
    expect(tplGrid.exists()).toBe(true)
    // step1 提示文案不再显示（TplGrid 本身即内容）
    expect(wrapper.text()).not.toContain('请在上方选择角色模板，然后点「下一步」开始配置。')
  })

  it('step2 时 TplGrid 不显示', async () => {
    const { wrapper, store } = await mountWizard()
    store.gotoStep(2)
    await flushPromises()
    expect(wrapper.find('.tpl-grid').exists()).toBe(false)
  })

  it('页面无「1 · 选择角色模板」常驻 section 标题', async () => {
    const { wrapper } = await mountWizard()
    expect(wrapper.text()).not.toContain('1 · 选择角色模板')
  })
})

describe('EmployeesView — 只显示已安装员工 + 底座徽章行', () => {
  beforeEach(() => {
    vi.mocked(fetchEmployees).mockReset()
  })

  it('hosts.length>0 的员工显示底座徽章行', async () => {
    const employees: EmployeeCard[] = [
      { id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现', avatar: '🧑‍💻', kind: 'flow-owner', version: '0.1.0', hosts: ['claude-code', 'qoder'] },
    ]
    vi.mocked(fetchEmployees).mockResolvedValue({ items: employees, invalid: [] })
    const wrapper = mount(EmployeesView, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).toContain('Qoder')
    expect(wrapper.find('[data-role="host-badges"]').exists()).toBe(true)
  })

  it('hosts=[] 的员工不显示（只显示已安装）', async () => {
    const employees: EmployeeCard[] = [
      { id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现', avatar: '🧑‍💻', kind: 'flow-owner', version: '0.1.0', hosts: ['claude-code'] },
      { id: 'custom-emp', display: '自定义员工', brief: '未安装', avatar: '🤖', kind: 'flow-owner', version: '0.1.0', hosts: [] },
    ]
    vi.mocked(fetchEmployees).mockResolvedValue({ items: employees, invalid: [] })
    const wrapper = mount(EmployeesView, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('开发工程师')
    expect(wrapper.text()).not.toContain('自定义员工')
  })

  it('空态：无已安装员工时显示空态引导', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: [], invalid: [] })
    const wrapper = mount(EmployeesView, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('新建员工')
  })
})

describe('CompletionPanel — generate 200 自动 saveAsTemplate', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
    vi.mocked(generateEmployee).mockReset()
    vi.mocked(saveAsTemplate).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('generate 200 → 自动调 saveAsTemplate（模板池 a 方案）', async () => {
    vi.mocked(generateEmployee).mockResolvedValue({
      package_path: '/path/to/employees/frontend-dev',
      files: ['AGENTS.md', 'manifest.yml'],
      manifest: { id: 'frontend-dev', display: '前端开发' },
    })
    vi.mocked(saveAsTemplate).mockResolvedValue({ id: 'tpl-frontend', display: '前端开发' })

    const { wrapper, store } = await mountWizard()
    Object.assign(store.draft, {
      display: '前端开发', id: 'frontend-dev', idTouched: true,
      identity: '专注前端界面实现，承接组件开发与页面构建。',
      principles: ['增量交付'], usage_modes: ['裸用'],
      kind: 'flow-owner', level: 'L2', brief: '前端开发员工',
      version: '0.1.0', redlines: [], deny: [],
      tier: '编码档', governanceLevel: 'L1', visibility: 'team', audit: 'exceptions-only',
      connectors: [], skills: [], selectedTemplateId: null,
    })
    store.gotoStep(6)
    await flushPromises()

    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()

    expect(generateEmployee).toHaveBeenCalledTimes(1)
    expect(saveAsTemplate).toHaveBeenCalledTimes(1)
  })

  it('saveAsTemplate 失败 → toast 提示但不妨碍完成态展示', async () => {
    vi.mocked(generateEmployee).mockResolvedValue({
      package_path: '/path/to/employees/frontend-dev',
      files: ['AGENTS.md', 'manifest.yml'],
      manifest: { id: 'frontend-dev', display: '前端开发' },
    })
    vi.mocked(saveAsTemplate).mockRejectedValue(new Error('保存模板服务未就绪'))

    const { wrapper, store } = await mountWizard()
    Object.assign(store.draft, {
      display: '前端开发', id: 'frontend-dev', idTouched: true,
      identity: '专注前端界面实现，承接组件开发与页面构建。',
      principles: ['增量交付'], usage_modes: ['裸用'],
      kind: 'flow-owner', level: 'L2', brief: '前端开发员工',
      version: '0.1.0', redlines: [], deny: [],
      tier: '编码档', governanceLevel: 'L1', visibility: 'team', audit: 'exceptions-only',
      connectors: [], skills: [], selectedTemplateId: null,
    })
    store.gotoStep(6)
    await flushPromises()

    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()

    // 完成态仍展示
    expect(wrapper.text()).toContain('员工包已生成')
    // toast 提示模板保存失败
    expect(wrapper.text()).toContain('保存模板服务未就绪')
  })
})
