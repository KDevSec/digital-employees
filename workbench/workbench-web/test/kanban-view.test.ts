// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { demoFlowTable } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'
import KanbanView from '../src/views/KanbanView.vue'
import { useKanbanStore } from '../src/stores/kanban'

/**
 * 看板页壳（L5 看板线 T8）：page-head + ConnectionBar + 空态/任务卡列表 + 发起入口。
 * 运行时接线（SSE 连接生命周期）在 T9 use-kanban-runtime；此处测「store 态 → 页面渲染」
 * 与空态语义。路由替换断言见 test/router.test.ts（结构性）+ placeholder.test.ts 摘除。
 */

const OPTS = { taskId: 'R-100', title: '支付网关对接联调', workspace: 'D:/demo/r-x' }

describe('KanbanView（看板页壳）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('空态：无任务 → 居中空卡 + 页头文案（「任务看板」标题）', () => {
    const w = mount(KanbanView)
    expect(w.find('h1').text()).toBe('任务看板')
    expect(w.find('.empty').exists()).toBe(true)
  })

  it('有任务：渲染任务卡列表 + ConnectionBar 在场', () => {
    const store = useKanbanStore()
    for (const ev of buildScenario('happy-path', OPTS)) store.applyIncoming(ev)
    store.setTable('R-100', demoFlowTable)
    store.connection = 'live'
    const w = mount(KanbanView)
    expect(w.findAll('.run-card')).toHaveLength(1)
    expect(w.find('.conn-bar').classes()).toContain('live')
  })

  it('发起任务按钮在场（KB-02 入口）', () => {
    const w = mount(KanbanView)
    expect(w.text()).toContain('发起任务')
  })
})
