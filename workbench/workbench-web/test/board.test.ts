// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { httpEngineApi, type EngineApi } from '../src/api/engine-api'
import { demoFlowTable } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'
import { applyEvent, emptyKanbanState, useKanbanStore, type TaskState } from '../src/stores/kanban'
import { LANES, laneOf, useBoardStore, type NeedDraft } from '../src/stores/board'
import BoardLane from '../src/components/board/BoardLane.vue'
import BoardCard from '../src/components/board/BoardCard.vue'
import NeedDrawer from '../src/components/board/NeedDrawer.vue'
import BoardView from '../src/views/BoardView.vue'
import { router } from '../src/router'

/**
 * T4 泳道任务列表层（1.0 协同编排形态·抄形不抄管线）：
 * 五列泳道（需求池→待办池→协同执行→待人工决策→已交付，后三列派生不可拖）+
 * 需求池→待办池拖拽发起（=createTask）+ 任务卡六件套 + 点卡进详情（双层衔接）。
 * 数据通道 = 2.0 契约（SSE 事件推送 + hydrate 重放，非 1.0 的 tick+全量重拉）。
 */

const OPTS = { taskId: 'R-1', title: '泳道任务', workspace: 'D:/demo/ws' }

// 路由守卫首导航拉 /api/state——测试环境统一打桩为已认证 ACTIVE（放行业务页）。
// 注意：个别用例末尾 unstubAllGlobals 会连带拆掉本桩，afterEach 重打保持全文件可用。
const fetchStateStub = vi.fn(async () =>
  new Response(JSON.stringify({ installationId: 'dev', status: 'ACTIVE', authenticated: true, user: { name: 'dev' } }), { status: 200 }))
vi.stubGlobal('fetch', fetchStateStub)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', fetchStateStub)
})

function taskOf(scenario: string, upto: number): TaskState {
  let state = emptyKanbanState()
  for (const ev of buildScenario(scenario as 'happy-path', OPTS).slice(0, upto)) state = applyEvent(state, ev)
  return state.tasks['R-1']
}

const bareTask = (over: Partial<TaskState>): TaskState => ({
  taskId: 'R-1', title: 'T', flow: 'demo-flow', displayName: '五阶段演示交付', workspace: 'D:/demo/ws',
  status: 'in_progress', currentNode: null, doneNodes: [], activeDispatches: [], gateRecords: [],
  blockedReason: null, durationS: null, lastSeq: 0, createdAt: '', updatedAt: '', ...over,
})

describe('laneOf 派生矩阵（五列划分——任务状态+进度派生，零硬编码）', () => {
  it('in_progress 未动工 → 待办池；有推进 → 协同执行', () => {
    expect(laneOf(bareTask({ status: 'in_progress', doneNodes: [] }))).toBe('plan')
    expect(laneOf(bareTask({ status: 'in_progress', doneNodes: ['n-adm'] }))).toBe('exec')
  })
  it('gate_paused / blocked → 待人工决策；completed / aborted → 已交付', () => {
    expect(laneOf(bareTask({ status: 'gate_paused' }))).toBe('decide')
    expect(laneOf(bareTask({ status: 'blocked' }))).toBe('decide')
    expect(laneOf(bareTask({ status: 'completed' }))).toBe('done')
    expect(laneOf(bareTask({ status: 'aborted' }))).toBe('done')
  })
  it('五列定义齐全（名称与彩点）', () => {
    expect(LANES.map((l) => l.name)).toEqual(['需求池', '待办池', '协同执行', '待人工决策', '已交付'])
    expect(new Set(LANES.map((l) => l.id)).size).toBe(5)
  })
})

describe('BoardLane（列头彩点+名+计数徽章；空态）', () => {
  it('列头渲染 + 计数 + 空态文案', () => {
    const w = mount(BoardLane, { props: { lane: LANES[0], cards: [] } })
    expect(w.find('.lane-head').text()).toContain('需求池')
    expect(w.find('.cnt').text()).toBe('0')
    expect(w.text()).toContain('暂无')
  })
})

describe('BoardCard（任务卡六件套）', () => {
  it('标题 + 状态 tag + 工作区名 tag + ⚖ 闸 tag；进度条与阶段链按表快照派生', () => {
    const task = taskOf('happy-path', 20) // 推进至中段
    const w = mount(BoardCard, { props: { task, table: demoFlowTable, lane: 'exec' } })
    expect(w.find('.ck-title').text()).toBe('泳道任务')
    expect(w.find('.ck-tags').text()).toContain('📁 ws')
    expect(w.find('.chain').exists()).toBe(true)
    expect(w.find('.bar').exists()).toBe(true)
  })

  it('表未到：进度条兜底百分比、阶段链缺省不炸', () => {
    const w = mount(BoardCard, { props: { task: bareTask({}), table: null, lane: 'plan' } })
    expect(w.find('.bar').exists()).toBe(true)
    expect(w.find('.chain').exists()).toBe(false)
  })

  it('blocked 常驻红条（错误块纪律⑥）+ aborted 已终止 tag', () => {
    const w = mount(BoardCard, {
      props: { task: bareTask({ status: 'blocked', blockedReason: 'spawn 失败：CLI 不可用' }), table: null, lane: 'decide' },
    })
    expect(w.find('.ck-block').text()).toContain('spawn 失败')
    const w2 = mount(BoardCard, { props: { task: bareTask({ status: 'aborted' }), table: null, lane: 'done' } })
    expect(w2.text()).toContain('已终止')
  })

  it('停靠列：amber 停靠提示 + 批准/驳回按钮组（驳回必填 note——emit）', async () => {
    const task = taskOf('gate-pause', 4) // 停靠 n0-req（human_gate）
    const w = mount(BoardCard, { props: { task, table: demoFlowTable, lane: 'decide' } })
    expect(w.find('.ck-stop').exists()).toBe(true)
    const btns = w.findAll('button')
    expect(btns.map((b) => b.text())).toContain('批准')
    await w.find('button.act-approve').trigger('click')
    expect(w.emitted('approve')).toBeTruthy()
    // 驳回必填 note（1.0 语义）：note 空 → 按钮禁用；填后 emit 带 note
    expect((w.find('button.act-reject').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('input[data-f="note"]').setValue('需求边界不清晰，请补充')
    await w.find('button.act-reject').trigger('click')
    expect(w.emitted('reject')).toBeTruthy()
    expect(w.emitted('reject')![0][1]).toBe('需求边界不清晰，请补充')
  })

  it('派生列卡不可拖；点卡 emit open（进详情）', async () => {
    const w = mount(BoardCard, { props: { task: bareTask({ status: 'completed' }), table: null, lane: 'done' } })
    expect(w.find('.ck-card').attributes('draggable')).toBeFalsy()
    await w.find('.ck-card').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })
})

describe('需求池拖拽发起（pool→plan = createTask）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('需求草稿入池（NeedDrawer emit add）+ 池内卡可拖、派单失败留池可重拖', () => {
    const board = useBoardStore()
    const need: NeedDraft = { id: 'n1', title: '登录页', input: '做一个登录页', workspace: 'D:/demo/ws', flow: 'demo-flow' }
    board.addNeed(need)
    expect(board.needs).toHaveLength(1)
    board.markNeedError('n1', '员工未安装')
    expect(board.needs[0].error).toContain('员工未安装') // 失败留池（1.0 重拖重试语义）
  })

  it('BoardView：拖需求入待办池 → createTask（真实 HTTP 面）→ 草稿出池；失败 → 错误常驻', async () => {
    const calls: unknown[] = []
    const api: EngineApi = {
      ...httpEngineApi,
      createTask: vi.fn(async (payload) => {
        calls.push(payload)
        if ((payload as { title: string }).title === '坏需求') throw new Error('员工 sec-compliance 未安装到底座')
        return { task_id: 'R-9' }
      }),
      listTasks: vi.fn(async () => ({ tasks: [], archived: [] })),
      getEvents: vi.fn(async () => [] as EngineEvent[]),
      getTask: vi.fn(async () => ({ task: { task_id: 'x' }, employees: {} })),
      getFlows: vi.fn(async () => []),
      confirmGate: vi.fn(async () => ({ ok: true })),
    }
    vi.stubGlobal('EventSource', class {
      readyState = 1; onopen = null; onerror = null
      addEventListener() {} close() {}
      constructor(public url: string) {}
    })
    const w = mount(BoardView, { global: { plugins: [router] }, props: { api } })
    await flushPromises()

    // 草稿入池
    const board = useBoardStore()
    board.addNeed({ id: 'n1', title: '好需求', input: 'x', workspace: 'D:/demo/ws', flow: 'demo-flow' })
    board.addNeed({ id: 'n2', title: '坏需求', input: 'y', workspace: 'D:/demo/ws', flow: 'demo-flow' })
    await flushPromises()

    // 派发两单：drop 目标 = 待办池
    const vm = w.vm as unknown as { dispatchNeed: (id: string) => Promise<void>; openTask: (id: string) => Promise<void> }
    await vm.dispatchNeed('n1')
    await vm.dispatchNeed('n2')
    await flushPromises()

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ mode: 'team', flow: 'demo-flow', title: '好需求' })
    expect(board.needs.map((n) => n.id)).toEqual(['n2']) // 成功出池、失败留池
    expect(board.needs[0].error).toContain('未安装')
    expect(w.text()).toContain('已发起编排') // toast 成功提示
    w.unmount()
    vi.unstubAllGlobals()
  })

  it('BoardView：引擎任务按 laneOf 分列渲染（五列计数）', async () => {
    vi.stubGlobal('EventSource', class {
      readyState = 1; onopen = null; onerror = null
      addEventListener() {} close() {}
      constructor(public url: string) {}
    })
    const api: EngineApi = {
      ...httpEngineApi,
      createTask: vi.fn(async () => ({ task_id: 'x' })),
      listTasks: vi.fn(async () => ({ tasks: [], archived: [] })),
      getEvents: vi.fn(async () => [] as EngineEvent[]),
      getTask: vi.fn(async () => ({ task: { task_id: 'x' }, employees: {} })),
      getFlows: vi.fn(async () => []),
      confirmGate: vi.fn(async () => ({ ok: true })),
    }
    const w = mount(BoardView, { global: { plugins: [router] }, props: { api } })
    await flushPromises()
    // 直接向 kanban store 灌三条不同状态任务 → 派生列计数
    const store = useKanbanStore()
    store.seedTask('R-plan'); store.seedTask('R-exec'); store.seedTask('R-done')
    store.applyIncoming({ ...bareEvent, task_id: 'R-exec', seq: 1, type: 'transition', from: 'n-adm', to: 'n0-req', status: 'in_progress' } as never)
    store.applyIncoming({ ...bareEvent, task_id: 'R-done', seq: 1, type: 'run.completed', final_node: 'n-done', duration_s: 10 } as never)
    await flushPromises()
    const lanes = w.findAll('.ck-lane')
    expect(lanes).toHaveLength(5)
    expect(lanes[1].find('.cnt').text()).toBe('1') // 待办池：R-plan
    expect(lanes[2].find('.cnt').text()).toBe('1') // 协同执行：R-exec
    expect(lanes[4].find('.cnt').text()).toBe('1') // 已交付：R-done
    w.unmount()
    vi.unstubAllGlobals()
  })
})

const bareEvent = {
  seq: 1, ts: '2026-08-27T00:00:00.000Z', trace_id: 'R-x', parent_seq: null, actor: 'engine', task_id: 'R-x',
} as const

describe('NeedDrawer（创建需求抽屉）', () => {
  it('开合 + 必填校验 + 加入需求池 emit', async () => {
    const w = mount(NeedDrawer, {
      props: { open: true, flows: [{ flow: 'demo-flow' }], defaultWorkspace: 'D:/demo/ws' },
    })
    expect(w.find('.drawer').exists()).toBe(true)
    // 空 title → 提交禁用
    expect((w.find('button.nd-submit').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('input[data-f="title"]').setValue('登录页交付')
    await w.find('textarea[data-f="input"]').setValue('实现登录页')
    expect((w.find('button.nd-submit').element as HTMLButtonElement).disabled).toBe(false)
    await w.find('button.nd-submit').trigger('submit')
    const emitted = w.emitted('add')![0][0] as NeedDraft
    expect(emitted.title).toBe('登录页交付')
    expect(emitted.workspace).toBe('D:/demo/ws')
    expect(emitted.flow).toBe('demo-flow')
  })

  it('关闭态不渲染', () => {
    const w = mount(NeedDrawer, { props: { open: false, flows: [], defaultWorkspace: '' } })
    expect(w.find('.drawer').exists()).toBe(false)
  })

  it('I2 方案 C 人工评审开关：勾选 humanReview + flow=simple-flow → emit add 载荷 flow=simple-flow-human', async () => {
    const w = mount(NeedDrawer, {
      props: {
        open: true,
        flows: [
          { flow: 'simple-flow', display_name: '五阶段快速交付' },
          { flow: 'simple-flow-human', display_name: '五阶段快速交付（人工评审）' },
        ],
        defaultWorkspace: 'D:/demo/ws',
      },
    })
    await w.find('input[data-f="title"]').setValue('登录页交付')
    await w.find('textarea[data-f="input"]').setValue('实现登录页')
    await w.find('input[data-f="humanReview"]').setValue(true)
    await w.find('button.nd-submit').trigger('submit')
    const emitted = w.emitted('add')![0][0] as NeedDraft
    expect(emitted.flow).toBe('simple-flow-human')
  })
})

describe('路由与双层衔接', () => {
  it('/kanban/board 指向 BoardView；/kanban 仍指 KanbanView（详情层不动）', async () => {
    await router.push('/kanban/board')
    await router.isReady()
    expect(router.currentRoute.value.matched[0]?.components?.default).toBeDefined()
    expect(router.currentRoute.value.path).toBe('/kanban/board')
  })

  it('点任务卡 → 跳 /kanban?task=<id>（双层衔接：泳道全景 → 任务详情）', async () => {
    vi.stubGlobal('EventSource', class {
      readyState = 1; onopen = null; onerror = null
      addEventListener() {} close() {}
      constructor(public url: string) {}
    })
    const api: EngineApi = {
      ...httpEngineApi,
      createTask: vi.fn(async () => ({ task_id: 'x' })),
      listTasks: vi.fn(async () => ({ tasks: [], archived: [] })),
      getEvents: vi.fn(async () => [] as EngineEvent[]),
      getTask: vi.fn(async () => ({ task: { task_id: 'x' }, employees: {} })),
      getFlows: vi.fn(async () => []),
      confirmGate: vi.fn(async () => ({ ok: true })),
    }
    const w = mount(BoardView, { global: { plugins: [router] }, props: { api } })
    await router.push('/kanban/board')
    await flushPromises()
    await (w.vm as unknown as { openTask: (id: string) => Promise<void> }).openTask('R-42')
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(router.currentRoute.value.query.task).toBe('R-42')
    w.unmount()
    vi.unstubAllGlobals()
  })
})
