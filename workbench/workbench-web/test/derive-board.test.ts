import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { UNGROUPED_STAGE, type TableSnapshot } from '../src/api/engine-table'
import { demoFlowTable, demoFlowGatePauseTable } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'
import { applyEvent, emptyKanbanState } from '../src/stores/kanban'
import { deriveBoard } from '../src/stores/derive-board'

/**
 * 派生层（L5 看板线 T5，设计 §5.2）：表快照 + 任务状态 → 阶段/节点渲染视图模型。
 * 零硬编码纪律①的落点——stage/name 全来自表，换表自动跟随（变体表断言即验收锚 K6/K7）。
 */

const OPTS = { taskId: 'R-100', title: 't', workspace: 'w' }

function replayTask(name: Parameters<typeof buildScenario>[0]) {
  let state = emptyKanbanState()
  for (const ev of buildScenario(name, OPTS)) state = applyEvent(state, ev)
  return state.tasks['R-100']
}

/** 便捷取节点视图 */
function nodeOf(board: ReturnType<typeof deriveBoard>, id: string) {
  for (const stage of board.stages) {
    const n = stage.nodes.find((x) => x.id === id)
    if (n) return n
  }
  throw new Error(`节点 ${id} 不在视图`)
}

describe('deriveBoard（表驱动渲染模型）', () => {
  it('demo 表 → 五阶段 + 未分组（terminal），阶段序=表序，节点齐', () => {
    const board = deriveBoard(demoFlowTable, replayTask('happy-path'))
    expect(board.stages.map((s) => s.name)).toEqual([
      '准入',
      '需求核验',
      '设计核验',
      '开发实现',
      '准出',
      UNGROUPED_STAGE,
    ])
    const all = board.stages.flatMap((s) => s.nodes.map((n) => n.id))
    expect(all).toEqual(demoFlowTable.nodes.map((n) => n.id))
    // 每阶段节点归属正确（需求核验 = n0-req + g-req-review）
    expect(board.stages[1].nodes.map((n) => n.id)).toEqual(['n0-req', 'g-req-review'])
  })

  it('happy-path 终态：全链 done，n-done active（terminal 到达）', () => {
    const board = deriveBoard(demoFlowTable, replayTask('happy-path'))
    for (const id of ['n-adm', 'n0-req', 'g-req-review', 'n2-impl', 'g-sec-code', 'n3-sec']) {
      expect(nodeOf(board, id).state, id).toBe('done')
    }
    expect(nodeOf(board, 'n-done').state).toBe('active')
    expect(nodeOf(board, 'n-fail').state).toBe('pending')
  })

  it('中段状态：done/active/pending 三态并存（推进到设计核验中）', () => {
    const events = buildScenario('happy-path', OPTS)
    let state = emptyKanbanState()
    for (const ev of events.slice(0, 11)) state = applyEvent(state, ev) // 至 transition→n1-design
    const board = deriveBoard(demoFlowTable, state.tasks['R-100'])
    expect(nodeOf(board, 'n-adm').state).toBe('done')
    expect(nodeOf(board, 'g-req-review').state).toBe('done')
    expect(nodeOf(board, 'n1-design').state).toBe('active')
    expect(nodeOf(board, 'n2-impl').state).toBe('pending')
  })

  it('gate-pause：停靠节点 paused（amber 高亮数据锚）', () => {
    const events = buildScenario('gate-pause', OPTS)
    let state = emptyKanbanState()
    for (const ev of events.slice(0, 4)) state = applyEvent(state, ev) // transition gate_paused→n0-req
    const board = deriveBoard(demoFlowGatePauseTable, state.tasks['R-100'])
    expect(nodeOf(board, 'n0-req').state).toBe('paused')
  })

  it('reflow：n2-impl 回流后重新 active，重派结束再回 done', () => {
    const events = buildScenario('reflow', OPTS)
    let mid = emptyKanbanState()
    // 推进到 reflow transition（g-code-review→n2-impl reflow）
    const reflowSeq = events.findIndex(
      (e) => e.type === 'transition' && (e as { reflow?: boolean }).reflow === true,
    )
    for (const ev of events.slice(0, reflowSeq + 1)) mid = applyEvent(mid, ev)
    const midBoard = deriveBoard(demoFlowTable, mid.tasks['R-100'])
    expect(midBoard && nodeOf(midBoard, 'n2-impl').state).toBe('active')

    const board = deriveBoard(demoFlowTable, replayTask('reflow'))
    expect(nodeOf(board, 'n2-impl').state).toBe('done')
  })

  it('活跃派发挂靠节点（DispatchCard 落位数据）', () => {
    const events = buildScenario('happy-path', OPTS)
    let state = emptyKanbanState()
    for (const ev of events.slice(0, 3)) state = applyEvent(state, ev) // n-adm dispatch start/done
    // n0-req dispatch start（seq5）
    const withStart = applyEvent(state, events[4] as EngineEvent)
    const board = deriveBoard(demoFlowTable, withStart.tasks['R-100'])
    expect(nodeOf(board, 'n0-req').activeDispatch).toMatchObject({ emp: 'req-clarifier' })
    expect(nodeOf(board, 'n-adm').activeDispatch).toBeNull()
  })

  it('空任务（run.created 未到/占位卡）：全 pending 不炸', () => {
    const board = deriveBoard(demoFlowTable, {
      ...replayTask('happy-path'),
      taskId: 'R-x',
      doneNodes: [],
      currentNode: null,
    })
    expect(board.stages.flatMap((s) => s.nodes).every((n) => n.state === 'pending')).toBe(true)
  })

  it('变体表跟随：gate-pause 表与 demo 表节点集同构但 human_gate 标记不同（K6 锚）', () => {
    const task = replayTask('gate-pause')
    const boardA = deriveBoard(demoFlowTable, task)
    const boardB = deriveBoard(demoFlowGatePauseTable, task)
    expect(boardB.stages.map((s) => s.name)).toEqual(boardA.stages.map((s) => s.name))
    expect(nodeOf(boardB, 'n0-req').humanGate).toBe(true)
    expect(nodeOf(boardA, 'n0-req').humanGate).toBe(false)
  })

  it('无 stage 节点全归未分组兜底（假想无 stage 表）', () => {
    const flat: TableSnapshot = {
      ...demoFlowTable,
      nodes: demoFlowTable.nodes.map((n) => ({ ...n, stage: undefined })),
    }
    const board = deriveBoard(flat, replayTask('happy-path'))
    expect(board.stages.map((s) => s.name)).toEqual([UNGROUPED_STAGE])
    expect(board.stages[0].nodes).toHaveLength(12)
  })
})
