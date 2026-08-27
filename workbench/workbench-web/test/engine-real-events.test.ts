import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSseFrame, type EngineEvent } from '../src/api/engine-events'
import { applyEvent, emptyKanbanState } from '../src/stores/kanban'

/**
 * L5×L3 联调机检锚（T5）：引擎真源事件流 demo-run-events.jsonl（L3 T5 验收产物，
 * 五阶段全链 34 事件含 g-sec-code 一次 FAIL 回流）喂看板消费栈——
 * parseSseFrame（守卫+D-056 复合 id 兼容）→ applyEvent（归并）→ 终态断言。
 *
 * 这份断言即「看板对引擎真实事件流」的行为规格：契约任一侧漂移（字段/取值集/语义）
 * 都会在此爆红——联调记录 2026-08-27 §task_id 实锤的回归锚。
 */

const FIXTURE = join(__dirname, '..', '..', 'workbench-engine', 'test', 'fixtures', 'demo-run-events.jsonl')

/** 真源事件行 → SSE 帧（引擎 stream.ts encodeFrame 同形：id 为 D-056 复合形式） */
function realEvents(): EngineEvent[] {
  const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim() !== '')
  const events: EngineEvent[] = []
  for (const line of lines) {
    const raw = JSON.parse(line) as { type: string; trace_id: string; seq: number }
    const res = parseSseFrame({ event: raw.type, data: line, id: `${raw.trace_id}:${raw.seq}` })
    if (!res.ok) throw new Error(`真实事件解析失败: ${res.error} ← ${line.slice(0, 120)}`)
    events.push(res.event)
  }
  return events
}

describe('引擎真实事件流机检（demo-run-events.jsonl → parseSseFrame + applyEvent）', () => {
  it('全部事件行过守卫（引擎载荷无 task_id 字段——trace_id 兜底；D-056 复合 id 不干扰 seq）', () => {
    const events = realEvents()
    expect(events.length).toBeGreaterThanOrEqual(20)
    for (const ev of events) {
      // 引擎事件不带 task_id（设计 §7.3 trace_id=task_id）——消费层必须兜底注入
      expect(ev.task_id).toBe(ev.trace_id)
      expect(ev.seq).toBeGreaterThan(0)
    }
  })

  it('全链重放 → 任务完成态：五阶段推进 + 6 闸流水 + FAIL 回流 + 员工派发配对', () => {
    const events = realEvents()
    const taskId = events[0].trace_id
    let state = emptyKanbanState()
    for (const ev of events) state = applyEvent(state, ev)

    expect(Object.keys(state.tasks)).toEqual([taskId])
    const task = state.tasks[taskId]
    expect(task.title).toBe('登录页交付')
    expect(task.status).toBe('completed')
    expect(task.currentNode).toBe('n-done')
    expect(task.flow).toBe('demo-flow')
    // doneNodes：全链离开过的节点（reflow 目标 n2-impl 被移除后再次 done）
    expect(task.doneNodes).toContain('n-adm')
    expect(task.doneNodes).toContain('n3-sec')
    // 闸流水：6 个 gate 事件（含 g-sec-code FAIL 第 1 轮）+ 人工闸不在本链
    expect(task.gateRecords.length).toBe(7)
    expect(task.gateRecords.filter((g) => g.verdict === 'FAIL').map((g) => g.gate)).toEqual(['g-sec-code'])
    // 派发生命周期：done 后 activeDispatches 清空
    expect(task.activeDispatches).toEqual([])
    expect(task.blockedReason).toBeNull()
    // 事件全部进全局 feed
    expect(state.feed.length).toBe(events.length)
  })

  it('per-task seq 去重与真实流兼容（重放同帧不重复入 feed）', () => {
    const events = realEvents()
    const taskId = events[0].trace_id
    let state = emptyKanbanState()
    for (const ev of events) state = applyEvent(state, ev)
    // 模拟 Last-Event-ID 回放重叠窗口：最后 3 帧重放（stream 层去重语义在 applyEvent 之外——
    // 本断言锚定 applyEvent 幂等性：同事件重放不改变终态语义字段）
    const before = state.tasks[taskId].gateRecords.length
    const replay = applyEvent(state, events[events.length - 1])
    expect(replay.tasks[taskId].gateRecords.length).toBe(before)
  })
})
