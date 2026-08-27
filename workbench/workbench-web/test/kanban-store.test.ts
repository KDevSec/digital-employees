// @vitest-environment jsdom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { buildScenario } from '../src/fixtures/scenarios'
import { applyEvent, emptyKanbanState, useKanbanStore, type KanbanState } from '../src/stores/kanban'

/**
 * 归并层（L5 看板线 T4，设计 §5.1）：applyEvent 纯函数 = 事件流 → 看板状态的唯一映射点
 * （D-kb02），四剧本全量重放断言即 KB-01 的行为规格；pinia 壳接线 SSE 消费层。
 */

const OPTS = { taskId: 'R-100', title: '支付网关对接联调', workspace: 'D:/demo/r-x' }

/** 剧本全量重放 → 终态 */
function replay(name: Parameters<typeof buildScenario>[0]): KanbanState {
  let state = emptyKanbanState()
  for (const ev of buildScenario(name, OPTS)) state = applyEvent(state, ev)
  return state
}

describe('applyEvent 单事件矩阵（设计 §5.1 七行语义）', () => {
  it('run.created：建卡（title/flow/displayName/workspace、in_progress）', () => {
    const ev = buildScenario('happy-path', OPTS)[0] as Extract<EngineEvent, { type: 'run.created' }>
    const s = applyEvent(emptyKanbanState(), ev)
    const t = s.tasks['R-100']
    expect(t).toBeDefined()
    expect(t.title).toBe(OPTS.title)
    expect(t.flow).toBe('demo-flow')
    expect(t.displayName).toBe('五阶段演示交付')
    expect(t.workspace).toBe(OPTS.workspace)
    expect(t.status).toBe('in_progress')
    expect(t.currentNode).toBeNull()
    expect(t.lastSeq).toBe(1)
  })

  it('dispatch start/done：员工卡出现与移除；error → 常驻错误（abort reason 终态覆盖）', () => {
    const events = buildScenario('abort', OPTS)
    const mid = events.slice(0, 5).reduce(applyEvent, emptyKanbanState()) // 到 dispatch start
    expect(mid.tasks['R-100'].activeDispatches).toHaveLength(1)
    expect(mid.tasks['R-100'].activeDispatches[0]).toMatchObject({ emp: 'req-clarifier', node: 'n0-req' })
    const errored = events.slice(0, 6).reduce(applyEvent, mid) // error done（run.aborted 未到）
    expect(errored.tasks['R-100'].activeDispatches).toHaveLength(0)
    expect(errored.tasks['R-100'].blockedReason).toContain('req-clarifier')
    const end = events.slice(6).reduce(applyEvent, errored) // run.aborted reason 终态覆盖
    expect(end.tasks['R-100'].blockedReason).toContain('spawn 失败')
  })

  it('transition：currentNode 推进 + from 入 doneNodes + status 快照覆盖', () => {
    const events = buildScenario('happy-path', OPTS)
    // seq4 = transition n-adm→n0-req
    const s = events.slice(0, 4).reduce(applyEvent, emptyKanbanState())
    expect(s.tasks['R-100'].currentNode).toBe('n0-req')
    expect(s.tasks['R-100'].doneNodes).toEqual(['n-adm'])
    // seq7 = transition n0-req→g-req-review
    const s2 = events.slice(4, 7).reduce(applyEvent, s)
    expect(s2.tasks['R-100'].doneNodes).toEqual(['n-adm', 'n0-req'])
    expect(s2.tasks['R-100'].currentNode).toBe('g-req-review')
  })

  it('gate：进评审流水（人工 confirm 也进——actor 保留）', () => {
    const events = buildScenario('gate-pause', OPTS)
    const s = events.reduce(applyEvent, emptyKanbanState())
    const human = s.tasks['R-100'].gateRecords.find((g) => g.actor === 'human')
    expect(human).toMatchObject({ gate: 'n0-req', verdict: 'approve', kind: 'acceptance' })
    expect(s.tasks['R-100'].gateRecords.filter((g) => g.kind === 'review')).toHaveLength(5)
  })

  it('transition status=gate_paused → 任务停靠态；blocked → 阻塞态', () => {
    const paused = buildScenario('gate-pause', OPTS).slice(0, 4).reduce(applyEvent, emptyKanbanState())
    expect(paused.tasks['R-100'].status).toBe('gate_paused')
  })

  it('未知 task_id 的事件（混流兜底分拣）：不炸，建最小占位任务卡', () => {
    const ev = buildScenario('happy-path', OPTS)[3]
    const s = applyEvent(emptyKanbanState(), { ...ev, task_id: 'R-999', trace_id: 'R-999' })
    expect(s.tasks['R-999']).toBeDefined()
    expect(s.tasks['R-999'].status).toBe('in_progress')
  })
})

describe('四剧本全量重放（KB-01 行为规格）', () => {
  it('happy-path：completed 终态、10 节点 done、5 条评审流水、无活跃派发', () => {
    const s = replay('happy-path')
    const t = s.tasks['R-100']
    expect(t.status).toBe('completed')
    expect(t.currentNode).toBe('n-done')
    expect(t.doneNodes).toHaveLength(10)
    expect(t.doneNodes).toContain('n3-sec')
    expect(t.gateRecords).toHaveLength(5)
    expect(t.gateRecords.every((g) => g.verdict === 'PASS')).toBe(true)
    expect(t.activeDispatches).toHaveLength(0)
    expect(t.durationS).toBeGreaterThan(0)
    expect(t.blockedReason).toBeNull()
  })

  it('gate-pause：经停 gate_paused 后 completed；人工放行在流水首位靠前出现', () => {
    const s = replay('gate-pause')
    const t = s.tasks['R-100']
    expect(t.status).toBe('completed')
    expect(t.gateRecords.some((g) => g.actor === 'human' && g.verdict === 'approve')).toBe(true)
    expect(t.doneNodes).toContain('n0-req')
  })

  it('reflow：n2-impl 重派后回到 done；g-code-review 两条流水（FAIL→PASS）', () => {
    const s = replay('reflow')
    const t = s.tasks['R-100']
    expect(t.status).toBe('completed')
    expect(t.doneNodes).toContain('n2-impl')
    const codeGates = t.gateRecords.filter((g) => g.gate === 'g-code-review')
    expect(codeGates.map((g) => `${g.verdict}:${g.iter}`)).toEqual(['FAIL:1', 'PASS:2'])
  })

  it('abort：aborted 终态 + 原因常驻', () => {
    const s = replay('abort')
    const t = s.tasks['R-100']
    expect(t.status).toBe('aborted')
    expect(t.blockedReason).toContain('spawn 失败')
  })

  it('feed 滚动窗口：全部事件进流水且按序（cap 前提下）', () => {
    const s = replay('happy-path')
    expect(s.feed).toHaveLength(37)
    expect(s.feed[0].type).toBe('run.created')
    expect(s.feed[s.feed.length - 1].type).toBe('run.completed')
  })
})

describe('pinia store 壳（SSE 消费层接线）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('connect：onEvent → applyIncoming 归并 + connection 跟随；disconnect 清理', () => {
    const store = useKanbanStore()
    let cb: ((ev: EngineEvent) => void) | undefined
    const stream = {
      onEvent: (c: (ev: EngineEvent) => void) => {
        cb = c
      },
      onConnectionChange: (c: (conn: string) => void) => {
        c('live')
      },
      close: () => {},
    }
    store.connect(stream as never)
    expect(store.connection).toBe('live')
    const scenario = buildScenario('gate-pause', OPTS)
    for (const ev of scenario) cb!(ev)
    expect(store.tasks['R-100'].status).toBe('completed')
    expect(store.feed.length).toBe(scenario.length)
    store.disconnect()
    expect(store.connection).toBe('closed')
  })

  it('混流双任务：事件按 task_id 分拣互不污染', () => {
    const store = useKanbanStore()
    const a = buildScenario('happy-path', { ...OPTS, taskId: 'R-a' })
    const b = buildScenario('abort', { taskId: 'R-b', title: 't', workspace: 'w' })
    const mixed = [
      ...a.slice(0, 6),
      ...b,
      ...a.slice(6),
    ]
    for (const ev of mixed) store.applyIncoming(ev)
    expect(store.tasks['R-a'].status).toBe('completed')
    expect(store.tasks['R-b'].status).toBe('aborted')
  })
})
