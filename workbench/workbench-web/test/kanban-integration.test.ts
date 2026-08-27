// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import KanbanView from '../src/views/KanbanView.vue'
import { useKanbanStore } from '../src/stores/kanban'
import { demoFlowTable, employees as empMap } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'

/**
 * 看板页 × 真实链路集成（L5 v0.2）：stub 掉 EventSource/fetch 后，剧本事件经
 * 「EventSource 回调 → 消费层 → store 归并 → 视图渲染」全链路（无 fixture runtime
 * 中间层——§13.3 纯真实接线的最小端到端）。
 */

/** 可驱动 FakeEventSource：记录页面注册的 listener，测试侧推帧 */
class FakeEventSource {
  readyState = 1
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  static last: FakeEventSource | null = null
  private listeners = new Map<string, Array<(ev: { data?: string; lastEventId?: string }) => void>>()
  constructor(public url: string) {
    FakeEventSource.last = this
  }
  addEventListener(type: string, listener: (ev: { data?: string; lastEventId?: string }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)!.push(listener)
  }
  close(): void {
    this.readyState = 2
  }
  /** 测试驱动：推一帧（模拟服务端 SSE 事件） */
  emit(ev: EngineEvent): void {
    const set = this.listeners.get(ev.type)
    if (set) for (const l of set) l({ data: JSON.stringify(ev), lastEventId: String(ev.seq) })
  }
}

vi.stubGlobal('EventSource', FakeEventSource)

vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.includes('/api/engine/flows')) {
    return new Response(JSON.stringify([{ flow: 'demo-flow', display_name: '五阶段演示交付' }]), { status: 200 })
  }
  if (url.includes('/api/engine/tasks/') && url.includes('/events')) {
    return new Response(JSON.stringify([]), { status: 200 })
  }
  if (url.includes('/api/engine/tasks/')) {
    return new Response(JSON.stringify({ task: { task_id: 'x' }, table: demoFlowTable, employees: empMap }), { status: 200 })
  }
  if (url.includes('/api/engine/tasks')) {
    return new Response(JSON.stringify({ task_id: 'R-1' }), { status: 202 })
  }
  return new Response('{}', { status: 404 })
}))

describe('KanbanView × 真实 SSE 链路集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mount 后经全局 EventSource 订阅 /api/engine/stream；事件推流 → 任务卡出 + 终态渲染', async () => {
    const store = useKanbanStore()
    const w = mount(KanbanView)
    await flushPromises()
    expect(FakeEventSource.last?.url).toBe('/api/engine/stream')

    const src = FakeEventSource.last!
    const scenario = buildScenario('happy-path', { taskId: 'R-1', title: '集成演示', workspace: 'D:/demo' })
    for (const ev of scenario) src.emit(ev)
    await flushPromises()

    // store 归并 + 视图渲染（表经 getTask fetch 落地）
    expect(store.tasks['R-1'].status).toBe('completed')
    expect(w.find('h1').text()).toBe('集成演示')
    expect(w.find('.status-tag').text()).toBe('已完成')
    expect(w.findAll('.sbstage').length).toBeGreaterThanOrEqual(5)
    expect(w.find('.watch-box').findAll('.watch-line').length).toBe(scenario.length)
    w.unmount()
  })

  it('初值拉取（重载不丢板）：mount → GET tasks 列表 + :id/events 重放 → 看板重建 + store 级 seq 幂等防 SSE 重放重复', async () => {
    // stream.ts 契约注释明确「看板首屏经 GET /api/engine/tasks 拉取，SSE 只管增量」——
    // L5×L3 联调实锤：原实现无初值拉取，页面重载即空板。hydrate = 事件溯源式重建
    const scenario = buildScenario('happy-path', { taskId: 'R-1', title: '重载任务', workspace: 'D:/demo' })
    const getEventsUrl = '/api/engine/tasks/R-1/events?after_seq=0'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/engine/tasks') {
        return new Response(JSON.stringify({ ok: true, tasks: [{ task_id: 'R-1', status: 'completed', title: '重载任务' }], archived: [] }), { status: 200 })
      }
      if (url === getEventsUrl) {
        return new Response(JSON.stringify({ ok: true, events: scenario }), { status: 200 })
      }
      if (url.includes('/api/engine/tasks/R-1/table')) {
        return new Response(JSON.stringify({ ok: true, table: demoFlowTable }), { status: 200 })
      }
      if (url.includes('/api/engine/tasks/R-1')) {
        return new Response(JSON.stringify({ ok: true, task: { task_id: 'R-1', title: '重载任务', flow: 'demo-flow', workspace: 'D:/demo' } }), { status: 200 })
      }
      if (url.includes('/api/engine/flows')) {
        return new Response(JSON.stringify({ ok: true, flows: [] }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }))

    const store = useKanbanStore()
    const w = mount(KanbanView)
    await flushPromises()

    // 看板经事件重放重建：标题/完成态/阶段横幅全部在场（无任何 SSE emit）
    expect(store.tasks['R-1'].status).toBe('completed')
    expect(w.find('h1').text()).toBe('重载任务')
    expect(w.find('.status-tag').text()).toBe('已完成')
    expect(w.findAll('.sbstage').length).toBeGreaterThanOrEqual(5)

    // store 级 seq 幂等：SSE 重放同帧（Last-Event-ID 回放窗口重叠）不重复入 feed
    const feedBefore = store.feed.length
    const gatesBefore = store.tasks['R-1'].gateRecords.length
    FakeEventSource.last!.emit(scenario[0]) // run.created seq=1 已重放过
    await flushPromises()
    expect(store.feed.length).toBe(feedBefore)
    expect(store.tasks['R-1'].gateRecords.length).toBe(gatesBefore)
    w.unmount()
  })
})
