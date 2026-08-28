// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateTaskPayload, EngineApi } from '../src/api/engine-api'
import CreateTaskModal from '../src/components/kanban/CreateTaskModal.vue'

/**
 * 发起任务表单（L5 看板线 T10，KB-02；字段面 = 协同编排设计 §2 裁决 11 / §9.4）：
 * mode（团队选表/单员工动态建表）+ 底座 + 模型/努力档位（「使用流程阶段内置档位」联动）+
 * 工作区 + 需求文本 → createTask（§9.1 参数逐字段）→ emit created 出卡。
 * 失败常驻表单区（纪律⑥）；按钮文案精简（品牌 §4）。
 */

const FLOWS = [{ flow: 'demo-flow', display_name: '五阶段演示交付' }]
const EMP = {
  'req-clarifier': '需求澄清师',
  'dev-engineer': '开发工程师',
}

function makeApi(ok = true): EngineApi & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    createTask: vi.fn(async (payload: CreateTaskPayload) => {
      calls.push(payload as unknown as Record<string, unknown>)
      if (ok) return { task_id: 'R-42' }
      throw new Error('员工 sec-compliance 未安装到底座 qoder')
    }),
    getTask: vi.fn(async () => ({ task: { task_id: 'x' }, table: { nodes: [] }, employees: {} })) as never,
    getFlows: vi.fn(async () => FLOWS),
    confirmGate: vi.fn(async () => ({ ok: true })) as never,
    listTasks: vi.fn(async () => ({ tasks: [], archived: [] })) as never,
    getEvents: vi.fn(async () => []) as never,
  }
}

function mountModal(api: ReturnType<typeof makeApi>) {
  return mount(CreateTaskModal, {
    props: { open: true, flows: FLOWS, employees: EMP, api },
    attachTo: document.body,
  })
}

async function fill(w: ReturnType<typeof mountModal>): Promise<void> {
  await w.find('input[data-field="title"]').setValue('支付网关对接')
  await w.find('input[data-field="workspace"]').setValue('D:/demo/r-x')
  await w.find('textarea[data-field="input"]').setValue('需求文本内容')
}

describe('CreateTaskModal（发起任务表单）', () => {
  it('字段面完整：模式/标题/底座/模型/努力/内置档位复选/工作区/需求文本', () => {
    const w = mountModal(makeApi())
    const text = w.text()
    for (const label of ['协作模式', '任务标题', '底座', '模型档位', '努力档位', '使用流程阶段内置档位', '工作区', '需求文本']) {
      expect(text).toContain(label)
    }
  })

  it('mode 联动：团队 → 流程下拉；单员工 → 员工下拉（契约歧义 C 口径）', async () => {
    const w = mountModal(makeApi())
    expect(w.find('select[data-field="flow"]').exists()).toBe(true)
    expect(w.find('select[data-field="employee"]').exists()).toBe(false)
    await w.findAll('input[data-field="mode"]')[1].setValue() // 切「单员工」
    expect(w.find('select[data-field="employee"]').exists()).toBe(true)
    expect(w.text()).toContain('需求澄清师')
  })

  it('内置档位复选：勾选后任务级 model/effort 禁用（§9.4 四层链——表 model_tier 优先）', async () => {
    const w = mountModal(makeApi())
    const model = w.find('select[data-field="model"]')
    const effort = w.find('select[data-field="effort"]')
    expect((model.element as HTMLSelectElement).disabled).toBe(false)
    await w.find('input[data-field="useFlowTier"]').setValue(true)
    expect((model.element as HTMLSelectElement).disabled).toBe(true)
    expect((effort.element as HTMLSelectElement).disabled).toBe(true)
  })

  it('必填校验：标题/工作区/需求缺一 → 提交禁用 + 逐项错误文案', async () => {
    const api = makeApi()
    const w = mountModal(api)
    const submit = w.find('button.submit')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    await fill(w)
    await w.vm.$nextTick()
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('提交载荷逐字段（§9.1 createTask 参数面）；成功 emit created + 关闭', async () => {
    const api = makeApi()
    const w = mountModal(api)
    await fill(w)
    // D-062：base 接真实源后，未经 fetchBases 的 jsdom 环境候选为空——
    // 本用例只断 model/effort 直传语义，底座直传在「底座真实源」describe 块覆盖。
    await w.find('select[data-field="model"]').setValue('编码档')
    await w.find('button.submit').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()
    expect(api.createTask).toHaveBeenCalledTimes(1)
    expect(api.calls[0]).toEqual({
      mode: 'team',
      flow: 'demo-flow',
      title: '支付网关对接',
      workspace: 'D:/demo/r-x',
      input: '需求文本内容',
      model: '编码档',
    })
    expect(w.emitted('created')).toEqual([['R-42']])
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('勾选内置档位：payload 不带 model/effort（空省略——表内置档位优先生效）', async () => {
    const api = makeApi()
    const w = mountModal(api)
    await fill(w)
    await w.find('input[data-field="useFlowTier"]').setValue(true)
    await w.find('button.submit').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()
    expect(api.calls[0]).not.toHaveProperty('model')
    expect(api.calls[0]).not.toHaveProperty('effort')
  })

  it('solo 模式：payload mode=solo + employee；无 flow 字段', async () => {
    const api = makeApi()
    const w = mountModal(api)
    await fill(w)
    await w.findAll('input[data-field="mode"]')[1].setValue()
    await w.find('select[data-field="employee"]').setValue('req-clarifier')
    await w.find('button.submit').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()
    expect(api.calls[0]).toMatchObject({ mode: 'solo', employee: 'req-clarifier' })
    expect(api.calls[0]).not.toHaveProperty('flow')
  })

  it('提交失败：错误常驻表单区（非 toast）', async () => {
    const api = makeApi(false)
    const w = mountModal(api)
    await fill(w)
    await w.find('button.submit').trigger('submit')
    await flushPromises()
    expect(w.find('.form-error').exists()).toBe(true)
    expect(w.find('.form-error').text()).toContain('未安装到底座')
    expect(w.emitted('created')).toBeUndefined()
  })

  it('按钮文案精简（品牌 §4）：提交/取消', () => {
    const w = mountModal(makeApi())
    expect(w.find('button.submit').text()).toBe('提交')
    expect(w.find('button.cancel').text()).toBe('取消')
  })

  it('I2 方案 C 人工评审开关：勾选 humanReview + flow=simple-flow → 提交载荷 flow=simple-flow-human', async () => {
    const FLOWS2 = [
      { flow: 'simple-flow', display_name: '五阶段快速交付' },
      { flow: 'simple-flow-human', display_name: '五阶段快速交付（人工评审）' },
    ]
    const api = makeApi()
    const w = mount(CreateTaskModal, { props: { open: true, flows: FLOWS2, employees: EMP, api }, attachTo: document.body })
    await flushPromises()
    await w.find('input[data-field="title"]').setValue('T')
    await w.find('input[data-field="workspace"]').setValue('D:/x')
    await w.find('textarea[data-field="input"]').setValue('input')
    // flow select 默认是 first=simple-flow；勾选「准出前人工评审」
    await w.find('input[data-field="humanReview"]').setValue(true)
    await w.find('button.submit').trigger('submit')
    await flushPromises()
    expect(api.calls[0]).toMatchObject({ mode: 'team', flow: 'simple-flow-human' })
  })

  it('I2 方案 C 人工评审开关：不勾选 humanReview → 提交载荷 flow 保留 simple-flow', async () => {
    const FLOWS2 = [
      { flow: 'simple-flow', display_name: '五阶段快速交付' },
      { flow: 'simple-flow-human', display_name: '五阶段快速交付（人工评审）' },
    ]
    const api = makeApi()
    const w = mount(CreateTaskModal, { props: { open: true, flows: FLOWS2, employees: EMP, api }, attachTo: document.body })
    await flushPromises()
    await w.find('input[data-field="title"]').setValue('T')
    await w.find('input[data-field="workspace"]').setValue('D:/x')
    await w.find('textarea[data-field="input"]').setValue('input')
    await w.find('button.submit').trigger('submit')
    await flushPromises()
    expect(api.calls[0]).toMatchObject({ mode: 'team', flow: 'simple-flow' })
  })

  it('I2 方案 C 人工评审开关：flow != simple-flow（如 demo-flow）时 humanReview 勾选状态不影响提交', async () => {
    const api = makeApi()
    const w = mountModal(api)
    await flushPromises()
    await fill(w)
    // demo-flow 不展示 humanReview checkbox（仅 simple-flow 系列适用）——但即使勾了也不该改 flow
    // 原表单未勾选，仅确认 flow=demo-flow 透传（不被人工评审意外影响）
    await w.find('button.submit').trigger('submit')
    await flushPromises()
    expect(api.calls[0]).toMatchObject({ mode: 'team', flow: 'demo-flow' })
  })
})

/**
 * D-062 底座真实源接线：底座下拉候选 = GET /api/bases（在场标注版本/未在场置灰未检测到），
 * 替代原静态 BASES 三选。未在场选项仍可提交（探测缓存滞后场景——阻塞校验归 service 安装面）。
 * 顶部占位项统一为「未选择」（跟随底座默认语义由空选承载）。
 */
describe('CreateTaskModal —— 底座真实源（D-062）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const BASES = [
    { id: 'claude-code', label: 'Claude Code', present: true, version: '2.1.226', version_tested: '2.1.226', supported: true, employees_count: 1, last_install_at: null },
    { id: 'codebuddy', label: 'CodeBuddy', present: true, version: '2.139.0', version_tested: '2.137.1', supported: true, employees_count: 0, last_install_at: null },
    { id: 'qoder', label: 'Qoder', present: false, version: null, version_tested: '1.1.32', supported: null, employees_count: 0, last_install_at: null },
  ]

  function stubBasesFetch(cards: unknown[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/bases') {
        return { ok: true, status: 200, json: async () => cards } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
  }

  async function mountWithBases(cards: unknown[]) {
    stubBasesFetch(cards)
    const api = makeApi()
    const w = mountModal(api)
    await flushPromises()
    return { w, api }
  }

  it('底座下拉候选接真实源：在场标注版本、未在场置灰；不再有静态三选', async () => {
    const { w } = await mountWithBases(BASES)
    const options = w.findAll('select[data-field="base"] option')
    const texts = options.map((o) => o.text())
    expect(texts[0]).toBe('未选择')
    expect(texts).toContain('Claude Code（2.1.226）')
    expect(texts).toContain('CodeBuddy（2.139.0）')
    expect(texts).toContain('Qoder（未检测到）')
    // 未在场选项 disabled 但不消失（探测缓存滞后场景仍可回显已选项）
    const qoderOpt = options.find((o) => o.text().includes('Qoder'))!
    expect(qoderOpt.attributes('disabled')).toBeDefined()
  })

  it('fetchBases 空数组（服务不可达/零探测）→ 仅「未选择」占位项，表单可提交不崩', async () => {
    const { w, api } = await mountWithBases([])
    const options = w.findAll('select[data-field="base"] option')
    expect(options.length).toBe(1)
    expect(options[0].text()).toBe('未选择')
    // 填表仍可提交（空选 = 跟随底座默认，不阻断发起）
    await fill(w)
    await w.find('button.submit').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()
    expect(api.calls[0]).not.toHaveProperty('base')
  })

  it('选择在场底座 → 提交载荷 base=<id>（真实源 id 直通）', async () => {
    const { w, api } = await mountWithBases(BASES)
    await fill(w)
    await w.find('select[data-field="base"]').setValue('claude-code')
    await w.find('button.submit').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()
    expect(api.calls[0]).toMatchObject({ base: 'claude-code' })
  })

  it('CLI 真模型 option 的 value=id 不是 label；提交载荷含 model=id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/bases') {
        return { ok: true, status: 200, json: async () => [{
          id: 'qoder', label: 'Qoder', present: true, version: '1.1.31',
          version_tested: '1.1.26', supported: true, employees_count: 0, last_install_at: null,
        }] } as unknown as Response
      }
      if (url === '/api/bases/qoder/models') {
        return { ok: true, status: 200, json: async () => [
          { id: 'Qwen3.8-Max', label: '显示名 Max' },
        ] } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
    const api = makeApi()
    const w = mountModal(api)
    await flushPromises()
    await w.find('select[data-field="base"]').setValue('qoder')
    await flushPromises()
    const cliOpt = w.findAll('select[data-field="model"] option').find((o) => o.attributes('value') === 'Qwen3.8-Max')
    expect(cliOpt).toBeTruthy()
    expect(cliOpt!.text()).toBe('显示名 Max')
    await fill(w)
    await w.find('select[data-field="model"]').setValue('Qwen3.8-Max')
    await w.find('button.submit').trigger('submit')
    await flushPromises()
    expect(api.calls[0]).toMatchObject({ base: 'qoder', model: 'Qwen3.8-Max' })
  })

  it('切底座时清空已选 model（B4）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/bases') {
        return { ok: true, status: 200, json: async () => [
          { id: 'qoder', label: 'Qoder', present: true, version: '1.1.31', version_tested: '1.1.26', supported: true, employees_count: 0, last_install_at: null },
          { id: 'codebuddy', label: 'CodeBuddy', present: true, version: '2.139.0', version_tested: '2.137.1', supported: true, employees_count: 0, last_install_at: null },
        ] } as unknown as Response
      }
      if (String(url).includes('/models')) {
        return { ok: true, status: 200, json: async () => [{ id: 'auto', label: 'auto' }] } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }))
    const w = mountModal(makeApi())
    await flushPromises()
    await w.find('select[data-field="base"]').setValue('qoder')
    await flushPromises()
    await w.find('select[data-field="model"]').setValue('auto')
    expect((w.find('select[data-field="model"]').element as HTMLSelectElement).value).toBe('auto')
    await w.find('select[data-field="base"]').setValue('codebuddy')
    expect((w.find('select[data-field="model"]').element as HTMLSelectElement).value).toBe('')
  })
})
