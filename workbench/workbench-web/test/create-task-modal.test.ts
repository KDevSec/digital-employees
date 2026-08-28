// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
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
    await w.find('select[data-field="base"]').setValue('qoder')
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
      base: 'qoder',
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
})
