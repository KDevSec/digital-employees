// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KanbanView from '../src/views/KanbanView.vue'
import { useKanbanStore } from '../src/stores/kanban'
import { demoFlowTable, employees as empMap } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'

/**
 * 看板页壳（L5 v0.2）：左树右详情工作台布局；纯真实接线（§13.3）——
 * EventSource/fetch 全 stub（页面代码零测试分支）。「store 态 → 页面渲染」+
 * 选中切换 + 停靠辅按钮 confirmGate 透传。
 */

vi.stubGlobal('EventSource', class {
  readyState = 1
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  addEventListener() {}
  close() {}
})

vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.includes('/api/engine/flows')) {
    return new Response(JSON.stringify([{ flow: 'demo-flow', display_name: '五阶段演示交付' }]), { status: 200 })
  }
  if (url.includes('/api/engine/tasks/')) {
    return new Response(
      JSON.stringify({ task: { task_id: 'x' }, table: demoFlowTable, employees: empMap }),
      { status: 200 },
    )
  }
  return new Response(JSON.stringify({ task_id: 'R-9' }), { status: 202 })
}))

const OPTS = { taskId: 'R-100', title: '支付网关对接联调', workspace: 'D:/demo/r-x' }

describe('KanbanView（v0.2 左树右详情）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('空态：左列「暂无任务」+ 右区空态引导 + 发起按钮在场（KB-02 入口）', async () => {
    const w = mount(KanbanView)
    await flushPromises()
    expect(w.text()).toContain('暂无任务')
    expect(w.text()).toContain('发起任务')
    expect(w.find('.detail-empty').exists()).toBe(true)
    w.unmount()
  })

  it('有任务：左列工作区分组 + 默认选中第一任务 → 右区详情（标题/阶段横幅/观战/流水）', async () => {
    const store = useKanbanStore()
    for (const ev of buildScenario('happy-path', OPTS)) store.applyIncoming(ev)
    store.setTable('R-100', demoFlowTable, empMap)
    const w = mount(KanbanView)
    await flushPromises()
    // 左列
    expect(w.findAll('.ws-group')).toHaveLength(1)
    expect(w.find('.task-row.active').text()).toContain('支付网关对接联调')
    // 右区详情
    expect(w.find('h1').text()).toBe('支付网关对接联调')
    expect(w.find('.status-tag').text()).toBe('已完成')
    const stages = w.findAll('.sbstage').filter((s) => !s.classes().includes('sbgate'))
    expect(stages.map((s) => s.find('.snm').text())).toEqual(['准入', '需求核验', '设计核验', '开发实现', '准出'])
    expect(w.find('.watch-box').exists()).toBe(true)
    expect(w.findAll('.gtl-row').length).toBeGreaterThanOrEqual(5)
    w.unmount()
  })

  it('点击左列其他任务行 → 右区详情切换', async () => {
    const store = useKanbanStore()
    for (const ev of buildScenario('happy-path', OPTS)) store.applyIncoming(ev)
    for (const ev of buildScenario('abort', { taskId: 'R-200', title: '中途终止演示', workspace: 'D:/demo/other' })) store.applyIncoming(ev)
    store.setTable('R-100', demoFlowTable, empMap)
    const w = mount(KanbanView)
    await flushPromises()
    const rowOf = (title: string) => w.findAll('.task-row').find((r) => r.text().includes(title))!
    // 两次切换：到中途终止演示 → 回支付网关对接联调（不依赖初始选中顺序）
    await rowOf('中途终止演示').trigger('click')
    await flushPromises()
    expect(w.find('h1').text()).toBe('中途终止演示')
    await rowOf('支付网关对接联调').trigger('click')
    await flushPromises()
    expect(w.find('h1').text()).toBe('支付网关对接联调')
    w.unmount()
  })

  it('停靠任务：告警卡在场 + 通过按钮 → POST confirm-gate（fetch 断言）', async () => {
    const store = useKanbanStore()
    for (const ev of buildScenario('gate-pause', OPTS).slice(0, 4)) store.applyIncoming(ev)
    store.setTable('R-100', demoFlowTable, empMap)
    const w = mount(KanbanView)
    await flushPromises()
    const alert = w.find('.alert-row.paused')
    expect(alert.exists()).toBe(true)
    await alert.findAll('button')[0].trigger('click')
    await flushPromises()
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit?]>
    const confirmCall = calls.find(([u]) => u.includes('confirm-gate'))
    expect(confirmCall?.[0]).toContain('/api/engine/tasks/R-100/confirm-gate')
    expect(JSON.parse(confirmCall?.[1]?.body as string)).toMatchObject({ node: 'n0-req', verdict: 'approve' })
    w.unmount()
  })
})
