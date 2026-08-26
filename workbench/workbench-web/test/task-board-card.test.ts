// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { demoFlowTable } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'
import { applyEvent, emptyKanbanState, type TaskState } from '../src/stores/kanban'
import TaskBoardCard from '../src/components/kanban/TaskBoardCard.vue'

/**
 * 任务大卡（L5 看板线 T8）：单任务完整视图——头（title/状态 tag/flow/workspace）+
 * 常驻错误条 + 闸位停靠条 + 五阶段泳道（deriveBoard 驱动）+ 评审流水。
 * 表快照未到时骨架态（契约歧义 A：表经 getTask 下发）。
 */

const OPTS = { taskId: 'R-100', title: '支付网关对接联调', workspace: 'D:/demo/r-x' }

function replayTask(name: Parameters<typeof buildScenario>[0]): TaskState {
  let state = emptyKanbanState()
  for (const ev of buildScenario(name, OPTS)) state = applyEvent(state, ev)
  return state.tasks['R-100']
}

const EMP = { 'reviewer-expert': '评审专家', 'req-clarifier': '需求澄清师' }

describe('TaskBoardCard（单任务大卡）', () => {
  it('任务头：title + 状态 tag + flow display + workspace', () => {
    const w = mount(TaskBoardCard, {
      props: { task: replayTask('happy-path'), table: demoFlowTable, employees: EMP, feed: [] },
    })
    const head = w.find('.run-head')
    expect(head.text()).toContain('支付网关对接联调')
    expect(head.text()).toContain('五阶段演示交付')
    expect(head.text()).toContain('D:/demo/r-x')
    expect(w.find('.status-tag').classes()).toContain('completed')
    expect(w.text()).toContain('已完成')
  })

  it('五阶段泳道渲染（demo 表 → 6 lane 含未分组）', () => {
    const w = mount(TaskBoardCard, {
      props: { task: replayTask('happy-path'), table: demoFlowTable, employees: EMP, feed: [] },
    })
    expect(w.findAll('.lane')).toHaveLength(6)
  })

  it('aborted/blocked：常驻红条带原因（纪律⑥，非 toast）', () => {
    const w = mount(TaskBoardCard, {
      props: { task: replayTask('abort'), table: demoFlowTable, employees: EMP, feed: [] },
    })
    const bar = w.find('.blocked-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('spawn 失败')
  })

  it('gate_paused：停靠条在场；confirm/reject 事件透传', async () => {
    const events = buildScenario('gate-pause', OPTS)
    let state = emptyKanbanState()
    for (const ev of events.slice(0, 4)) state = applyEvent(state, ev)
    const w = mount(TaskBoardCard, {
      props: { task: state.tasks['R-100'], table: demoFlowTable, employees: EMP, feed: [] },
    })
    expect(w.find('.gate-pause-bar').exists()).toBe(true)
    await w.findAll('.gate-pause-bar button')[0].trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
  })

  it('表快照未到：骨架态（不渲染 lane，不炸）', () => {
    const w = mount(TaskBoardCard, {
      props: { task: replayTask('happy-path'), table: null, employees: EMP, feed: [] },
    })
    expect(w.find('.skeleton').exists()).toBe(true)
    expect(w.findAll('.lane')).toHaveLength(0)
  })

  it('评审流水：gateRecords + 本任务 run 事件（feed 过滤 task_id）', () => {
    const all: EngineEvent[] = buildScenario('happy-path', OPTS)
    const foreign = buildScenario('abort', { taskId: 'R-x', title: 't', workspace: 'w' })
    const w = mount(TaskBoardCard, {
      props: {
        task: replayTask('happy-path'),
        table: demoFlowTable,
        employees: EMP,
        feed: [...all, ...foreign].filter((e) => e.task_id === 'R-100'),
      },
    })
    expect(w.findAll('.feed-row').length).toBeGreaterThanOrEqual(7) // 5 gate + 任务发起 + 任务完成
  })

  it('状态 tag 五态映射', () => {
    const cases: Array<[TaskState['status'], string]> = [
      ['in_progress', '进行中'],
      ['gate_paused', '闸位停靠'],
      ['blocked', '阻塞'],
      ['completed', '已完成'],
      ['aborted', '已终止'],
    ]
    for (const [status, text] of cases) {
      const w = mount(TaskBoardCard, {
        props: { task: { ...replayTask('happy-path'), status }, table: demoFlowTable, employees: EMP, feed: [] },
      })
      expect(w.find('.status-tag').text(), status).toBe(text)
    }
  })
})
