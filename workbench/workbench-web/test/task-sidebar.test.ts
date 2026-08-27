// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskSidebar from '../src/components/kanban/TaskSidebar.vue'
import type { TaskState } from '../src/stores/kanban'

/**
 * 左列任务树（L5 v0.2，对齐 1.0 demo 任务看板左列）：工作区分组（task.workspace 键）
 * 可折叠 → 任务行（状态图标/迷你进度/标题）；点击切换右侧详情。
 */

function task(p: Partial<TaskState> & { taskId: string; workspace: string }): TaskState {
  return {
    title: p.taskId,
    flow: 'demo-flow',
    displayName: '',
    status: 'in_progress',
    currentNode: null,
    doneNodes: [],
    activeDispatches: [],
    gateRecords: [],
    blockedReason: null,
    durationS: null,
    lastSeq: 0,
    createdAt: '2026-08-27T02:00:00.000Z',
    updatedAt: '2026-08-27T02:00:00.000Z',
    ...p,
  }
}

const TABLE_NODE_TOTAL = 10 // demo 表非 terminal 节点数（迷你进度分母）

const TASKS: TaskState[] = [
  task({ taskId: 'R-1', workspace: 'D:/demo/r-x', title: '支付网关对接', status: 'in_progress', doneNodes: ['n-adm', 'n0-req'] }),
  task({ taskId: 'R-2', workspace: 'D:/demo/r-x', title: '官网改版', status: 'gate_paused' }),
  task({ taskId: 'R-3', workspace: 'D:/works/other', title: '独立任务', status: 'completed', doneNodes: ['n-adm'] }),
]

describe('TaskSidebar（工作区分组任务树）', () => {
  it('按工作区分组渲染：两组头 + 各自任务行', () => {
    const w = mount(TaskSidebar, { props: { tasks: TASKS, selectedId: 'R-1', nodeTotals: { 'R-1': TABLE_NODE_TOTAL, 'R-2': TABLE_NODE_TOTAL, 'R-3': TABLE_NODE_TOTAL } } })
    const groups = w.findAll('.ws-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].text()).toContain('D:/demo/r-x')
    expect(groups[0].findAll('.task-row')).toHaveLength(2)
    expect(groups[1].text()).toContain('D:/works/other')
  })

  it('任务行：标题 + 状态图标类（进行中/停靠/完成）+ 迷你进度', () => {
    const w = mount(TaskSidebar, { props: { tasks: TASKS, selectedId: 'R-1', nodeTotals: { 'R-1': TABLE_NODE_TOTAL, 'R-2': TABLE_NODE_TOTAL, 'R-3': TABLE_NODE_TOTAL } } })
    const rows = w.findAll('.task-row')
    expect(rows[0].text()).toContain('支付网关对接')
    expect(rows[0].find('.ticon').classes()).toContain('in-progress')
    expect(rows[1].find('.ticon').classes()).toContain('gate-paused')
    expect(rows[2].find('.ticon').classes()).toContain('completed')
    // 迷你进度：R-1 done 2/10 → 20%
    expect(rows[0].find('.pctmini').attributes('style')).toContain('20%')
    // 表未到的任务（无分母）不渲染进度条
    const w2 = mount(TaskSidebar, { props: { tasks: TASKS, selectedId: null, nodeTotals: {} } })
    expect(w2.find('.pctmini').exists()).toBe(false)
  })

  it('选中行高亮（active 类）；点击 emit select', async () => {
    const w = mount(TaskSidebar, { props: { tasks: TASKS, selectedId: 'R-1', nodeTotals: {} } })
    expect(w.findAll('.task-row')[0].classes()).toContain('active')
    await w.findAll('.task-row')[1].trigger('click')
    expect(w.emitted('select')).toEqual([['R-2']])
  })

  it('折叠分组：点击组头收起该组任务行（其他组不受影响）', async () => {
    const w = mount(TaskSidebar, { props: { tasks: TASKS, selectedId: null, nodeTotals: {} } })
    await w.findAll('.ws-head')[0].trigger('click')
    const groups = w.findAll('.ws-group')
    expect(groups[0].find('.task-row').isVisible()).toBe(false)
    expect(groups[1].find('.task-row').isVisible()).toBe(true)
  })

  it('空任务：整列空态提示', () => {
    const w = mount(TaskSidebar, { props: { tasks: [], selectedId: null, nodeTotals: {} } })
    expect(w.text()).toContain('暂无任务')
  })
})
