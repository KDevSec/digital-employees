// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
  uploadSkillZip: vi.fn(),
}))

import { fetchSkills, fetchTemplates, uploadSkillZip } from '../src/api/templates'
import type { SkillMeta, TemplateMeta } from '../src/api/templates'
import StepAgent from '../src/components/wizard/steps/StepAgent.vue'
import StepCommandsFlow from '../src/components/wizard/steps/StepCommandsFlow.vue'
import StepConnectors from '../src/components/wizard/steps/StepConnectors.vue'
import StepHooksTools from '../src/components/wizard/steps/StepHooksTools.vue'
import StepKnowledge from '../src/components/wizard/steps/StepKnowledge.vue'
import StepSkills from '../src/components/wizard/steps/StepSkills.vue'
import { useWizardStore } from '../src/stores/wizard'

/**
 * 七步表单组件（L1 员工新建线 Task 14）：
 * - StepAgent：岗位名/员工 ID/头像选择/职责描述/工作原则/使用深度；slug 联动 + idTouched 停跟；
 * - StepSkills：内置 skill 全集网格 + 搜索 + zip 上传 + 已选清单；
 * - StepHooksTools：红线 check-grid + 折叠区「高级设置」（tier/token/可见性/审计/治理级别）；
 * - StepCommandsFlow：Commands 占位说明 + 流程区只读文案；
 * - StepKnowledge：占位卡「暂未开放」；
 * - StepConnectors：MCP 模板默认连接器只读列表。
 *
 * 禁词红线（Global Constraint）：全部 Step 组件渲染文本不含「底座」「安装」「AgentHub」。
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

const skills: SkillMeta[] = [
  { name: 'tdd-methodology', version: '1.0.0', description: 'TDD 流程方法论', templateId: 'dev-engineer', builtin: true },
  { name: 'secure-coding', version: '1.0.0', description: '安全编码规范', templateId: 'dev-engineer', builtin: true },
  { name: 'review-verdict', version: '1.0.0', description: '评审裁决回函', templateId: 'reviewer', builtin: true },
]

function setupStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useWizardStore()
  store.$patch({ templates: [devEngineer], skills })
  return { store, pinia }
}

describe('StepAgent（身份定义 + slug 联动）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('双向绑定：input display → draft.display 同步', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepAgent, { global: { plugins: [pinia] } })
    // 直接改 store.draft.display，组件应反映
    store.draft.display = '前端开发'
    await flushPromises()
    const input = wrapper.find('input[data-field="display"]')
    expect((input.element as HTMLInputElement).value).toBe('前端开发')
  })

  it('slug 联动：未 touched 时改 display 自动同步 id（slugify）', async () => {
    const { store, pinia } = setupStore()
    mount(StepAgent, { global: { plugins: [pinia] } })
    // 通过 store 改 display（组件内 watch 会同步 id）
    store.draft.display = 'Frontend Dev!'
    await flushPromises()
    expect(store.draft.id).toBe('frontend-dev')
    expect(store.draft.idTouched).toBe(false)
  })

  it('id 手改 → idTouched=true 停跟', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepAgent, { global: { plugins: [pinia] } })
    const idInput = wrapper.find('input[data-field="id"]')
    await idInput.setValue('custom-id')
    expect(store.draft.idTouched).toBe(true)
    // 后续改 display 不再同步 id
    store.draft.display = 'Backend Dev!'
    await flushPromises()
    expect(store.draft.id).toBe('custom-id') // 停跟
  })

  it('头像选择：12 emoji 池渲染 + 点击更新 draft.avatar', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepAgent, { global: { plugins: [pinia] } })
    const avatarBtns = wrapper.findAll('[data-avatar]')
    expect(avatarBtns.length).toBe(12)
    await avatarBtns[0].trigger('click')
    expect(store.draft.avatar).not.toBe('')
  })

  it('职责描述 textarea 双向绑定（persona.identity）', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepAgent, { global: { plugins: [pinia] } })
    const ta = wrapper.find('textarea[data-field="identity"]')
    await ta.setValue('专注前端界面实现。')
    expect(store.draft.identity).toBe('专注前端界面实现。')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepAgent, { global: { plugins: [pinia] } })
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('StepSkills（能力配置 + 搜索 + 上传）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
    vi.mocked(uploadSkillZip).mockReset()
  })

  it('全集网格渲染：3 个 skill 卡', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const items = wrapper.findAll('[data-skill]')
    expect(items.length).toBe(3)
  })

  it('勾选 skill → draft.skills 增；取消 → 减', async () => {
    const { store, pinia } = setupStore()
    store.selectTemplate(devEngineer) // 默认勾选 dev-engineer 的 2 个 skill
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(store.draft.skills.length).toBe(2)
    // 取消第一个
    const firstItem = wrapper.findAll('[data-skill]')[0]
    await firstItem.trigger('click')
    expect(store.draft.skills.length).toBe(1)
    // 再勾上
    await firstItem.trigger('click')
    expect(store.draft.skills.length).toBe(2)
  })

  it('搜索过滤：name/description 模糊匹配', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const search = wrapper.find('input[data-role="skill-search"]')
    await search.setValue('TDD')
    await flushPromises()
    const items = wrapper.findAll('[data-skill]')
    expect(items.length).toBe(1)
    expect(items[0].text()).toContain('tdd-methodology')
  })

  it('上传 mock 成功 → 进已选清单带「本地上传」徽章', async () => {
    vi.mocked(uploadSkillZip).mockResolvedValue({ name: 'my-skill', version: '0.1.0', description: '我的本地 skill' })
    const { store, pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const file = new File(['zip-content'], 'my-skill.zip', { type: 'application/zip' })
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [file],
      writable: false,
      configurable: true,
    })
    await fileInput.trigger('change')
    await flushPromises()
    expect(uploadSkillZip).toHaveBeenCalledTimes(1)
    expect(store.draft.skills.some((s) => s.name === 'my-skill' && s.source_type === 'local')).toBe(true)
    expect(wrapper.text()).toContain('本地上传')
  })

  it('F2：草稿恢复场景 local skill needsReupload=true → 已选清单显示「需重新上传」徽章', async () => {
    const { store, pinia } = setupStore()
    // 模拟草稿恢复：local skill 带 needsReupload=true
    store.draft.skills = [
      { name: 'restored-skill', version: '0.1.0', source_type: 'local', description: '恢复的 skill', needsReupload: true },
    ]
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const reuploadBadge = wrapper.find('[data-role="needs-reupload"]')
    expect(reuploadBadge.exists()).toBe(true)
    expect(reuploadBadge.text()).toContain('需重新上传')
  })

  it('F2：上传新 skill（非草稿恢复）不带 needsReupload → 不显示「需重新上传」徽章', async () => {
    vi.mocked(uploadSkillZip).mockResolvedValue({ name: 'fresh-skill', version: '0.1.0', description: '新上传' })
    const { pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const file = new File(['zip-content'], 'fresh-skill.zip', { type: 'application/zip' })
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [file],
      writable: false,
      configurable: true,
    })
    await fileInput.trigger('change')
    await flushPromises()
    expect(wrapper.find('[data-role="needs-reupload"]').exists()).toBe(false)
  })

  it('上传失败 → toast 错误信息（不进已选）', async () => {
    vi.mocked(uploadSkillZip).mockRejectedValue(new Error('zip 解压失败'))
    const { store, pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const file = new File(['bad'], 'bad.zip', { type: 'application/zip' })
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [file],
      writable: false,
      configurable: true,
    })
    await fileInput.trigger('change')
    await flushPromises()
    expect(store.draft.skills.some((s) => s.source_type === 'local')).toBe(false)
    expect(wrapper.text()).toContain('zip 解压失败')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepSkills, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('StepHooksTools（约束 + 工具白名单）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })

  it('红线 7 项渲染（含括号举例描述）', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const items = wrapper.findAll('[data-redline]')
    expect(items.length).toBe(7)
    const text = wrapper.text()
    expect(text).toContain('禁止直接推送到主分支（如 git push origin main / master）')
    expect(text).toContain('危险操作必须经人工确认（如 rm -rf、删除文件夹、修改系统配置）')
    expect(text).toContain('自定义红线规则（暂未开放）')
  })

  it('勾选红线 → draft.redlines 增', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const first = wrapper.findAll('[data-redline]')[0]
    await first.trigger('click')
    expect(store.draft.redlines.some((r) => r.rule_id === 'no-push-to-main')).toBe(true)
  })

  it('工具黑名单：默认无禁用（deny 为空，toolsAllowed 全集）', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const chips = wrapper.findAll('[data-tool]')
    expect(chips.length).toBe(10)
    expect(store.draft.toolsAllowed.length).toBe(10)
    expect(store.draft.deny).toEqual([])
  })

  it('工具黑名单：勾选 → deny 追加（反向语义）', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const bashChip = wrapper.findAll('[data-tool]').find((c) => c.text().includes('Bash'))
    await bashChip!.trigger('click')
    expect(store.draft.deny).toContain('Bash')
    expect(store.draft.deny).not.toContain('Read')
    // deny-preview 更新
    expect(wrapper.text()).toContain('已禁 1 个')
  })

  it('权限管理总开关：默认开；关闭后 redlines 与 deny 全部不启用（不写入员工包）', async () => {
    const { store, pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
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

  it('层级：高级设置已移除（无 tier/token/治理 UI）', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('高级设置')
    expect(text).not.toContain('模型档位')
    expect(text).not.toContain('Token')
    expect(text).not.toContain('可见范围')
    expect(text).not.toContain('审计级别')
    expect(text).not.toContain('治理级别')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepHooksTools, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('StepCommandsFlow（Commands + 流程只读）', () => {
  it('Commands 占位说明在位', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepCommandsFlow, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Commands')
    expect(text).toContain('V0.2')
  })

  it('流程区只读说明在位', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepCommandsFlow, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('流程表')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepCommandsFlow, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('StepKnowledge（占位）', () => {
  it('占位卡「暂未开放」文案在位', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepKnowledge, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('暂未开放')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepKnowledge, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})

describe('StepConnectors（MCP 只读）', () => {
  it('模板默认连接器只读说明在位', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepConnectors, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('连接器')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」', async () => {
    const { pinia } = setupStore()
    const wrapper = mount(StepConnectors, { global: { plugins: [pinia] } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('底座')
    expect(text).not.toContain('安装')
    expect(text).not.toContain('AgentHub')
  })
})
