import { describe, expect, it } from 'vitest'
import { parseEngineEvent, parseSseFrame, type EngineEvent } from '../src/api/engine-events'

/**
 * 引擎事件消费契约（L5 看板线 T1，设计 §3.1 对齐协同编排设计 §7.3）：
 * parseEngineEvent / parseSseFrame 为纯函数——外部数据不可信（health.ts 同款纪律），
 * 类型不符归一 ok:false 不抛异常；六类事件载荷字段严格对齐 §7.3 表（snake_case 原样）。
 * 本文件即事件契约的消费者侧锚：引擎线联调时真实事件流跑同一校验。
 */

/** 通用壳完整、载荷为 run.created 的合法帧 */
function baseEvent(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    seq: 1,
    ts: '2026-08-27T10:00:00.000Z',
    trace_id: 'R-100',
    parent_seq: null,
    actor: 'engine',
    task_id: 'R-100',
    ...partial,
  }
}

describe('parseEngineEvent（六类事件类型守卫矩阵）', () => {
  it('run.created：载荷字段完备 → ok 且判别联合窄化正确', () => {
    const res = parseEngineEvent(
      baseEvent({
        type: 'run.created',
        flow: 'demo-flow',
        title: '支付网关对接',
        workspace: 'D:/demo/r-x',
        display_name: '五阶段演示交付',
      }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      const ev = res.event as Extract<EngineEvent, { type: 'run.created' }>
      expect(ev.flow).toBe('demo-flow')
      expect(ev.title).toBe('支付网关对接')
      expect(ev.workspace).toBe('D:/demo/r-x')
      expect(ev.display_name).toBe('五阶段演示交付')
    }
  })

  it('run.completed：final_node/duration_s → ok', () => {
    const res = parseEngineEvent(
      baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: 108 }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect((res.event as Extract<EngineEvent, { type: 'run.completed' }>).duration_s).toBe(108)
    }
  })

  it('run.aborted：final_node/reason → ok', () => {
    const res = parseEngineEvent(
      baseEvent({ type: 'run.aborted', final_node: 'n0-req', reason: 'spawn 失败' }),
    )
    expect(res.ok).toBe(true)
  })

  it('transition：from/to/status（reflow/forced_fail/reason 可选）→ ok', () => {
    const res = parseEngineEvent(
      baseEvent({ type: 'transition', from: 'g-code-review', to: 'n2-impl', reflow: true, status: 'in_progress' }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      const ev = res.event as Extract<EngineEvent, { type: 'transition' }>
      expect(ev.reflow).toBe(true)
      expect(ev.forced_fail).toBeUndefined()
    }
  })

  it('transition：from 允许 null（首节点推进）→ ok', () => {
    const res = parseEngineEvent(
      baseEvent({ type: 'transition', from: null, to: 'n-adm', status: 'in_progress' }),
    )
    expect(res.ok).toBe(true)
  })

  it('gate：gate/kind/node/verdict/iter/reviewer（issues/request_id 可选）→ ok', () => {
    const res = parseEngineEvent(
      baseEvent({
        type: 'gate',
        gate: 'g-code-review',
        kind: 'review',
        node: 'n2-impl',
        verdict: 'FAIL',
        iter: 1,
        reviewer: 'reviewer-expert',
        issues: ['测试未覆盖边界条件 X'],
      }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect((res.event as Extract<EngineEvent, { type: 'gate' }>).issues).toEqual([
        '测试未覆盖边界条件 X',
      ])
    }
  })

  it('dispatch：phase=start（node 携带，status/usage 可缺）→ ok', () => {
    const res = parseEngineEvent(
      baseEvent({
        type: 'dispatch',
        phase: 'start',
        emp: 'sec-compliance',
        dispatch_id: 'D-1',
        node: 'n-adm',
      }),
    )
    expect(res.ok).toBe(true)
  })

  it('dispatch：phase=done（status/usage 在场）→ ok', () => {
    const res = parseEngineEvent(
      baseEvent({
        type: 'dispatch',
        phase: 'done',
        emp: 'sec-compliance',
        dispatch_id: 'D-1',
        node: 'n-adm',
        status: 'ok',
        usage: { tokens: 214000 },
      }),
    )
    expect(res.ok).toBe(true)
  })

  it('守卫拒绝：缺 task_id → ok:false 不抛', () => {
    const bad = baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: 1 })
    delete bad.task_id
    expect(parseEngineEvent(bad)).toEqual({ ok: false, error: expect.stringContaining('task_id') })
  })

  it('守卫拒绝：seq 非数字 → ok:false', () => {
    expect(
      parseEngineEvent(
        baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: 1, seq: 'x' }),
      ).ok,
    ).toBe(false)
  })

  it('守卫拒绝：parent_seq 既非数字也非 null → ok:false', () => {
    expect(
      parseEngineEvent(
        baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: 1, parent_seq: '1' }),
      ).ok,
    ).toBe(false)
  })

  it('守卫拒绝：dispatch.phase 非法值 → ok:false', () => {
    expect(
      parseEngineEvent(
        baseEvent({ type: 'dispatch', phase: 'cancel', emp: 'a', dispatch_id: 'D-1' }),
      ).ok,
    ).toBe(false)
  })

  it('守卫拒绝：gate 缺 verdict → ok:false', () => {
    expect(
      parseEngineEvent(
        baseEvent({
          type: 'gate',
          gate: 'g-x',
          kind: 'review',
          node: 'n0-req',
          iter: 1,
          reviewer: 'reviewer-expert',
        }),
      ).ok,
    ).toBe(false)
  })

  it('守卫拒绝：transition 缺 status → ok:false', () => {
    expect(
      parseEngineEvent(baseEvent({ type: 'transition', from: 'a', to: 'b' })).ok,
    ).toBe(false)
  })

  it('守卫拒绝：duration_s 非数字 → ok:false', () => {
    expect(
      parseEngineEvent(
        baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: '108' }),
      ).ok,
    ).toBe(false)
  })

  it('守卫拒绝：未知事件 type → ok:false', () => {
    expect(parseEngineEvent(baseEvent({ type: 'heartbeat' })).ok).toBe(false)
  })
})

describe('parseSseFrame（SSE 事件帧 → EngineEvent）', () => {
  it('合法帧：event/data/id 三元齐全 → ok 且 seq 取自 id', () => {
    const data = JSON.stringify(
      baseEvent({
        type: 'transition',
        from: 'n-adm',
        to: 'n0-req',
        status: 'in_progress',
        seq: 4,
      }),
    )
    const res = parseSseFrame({ event: 'transition', data, id: '4' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.event.seq).toBe(4)
  })

  it('未知 event type → ok:false（错误信息带 type 名）', () => {
    const res = parseSseFrame({ event: 'heartbeat', data: '{}', id: '1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('heartbeat')
  })

  it('data 坏 JSON → ok:false 不抛', () => {
    expect(parseSseFrame({ event: 'transition', data: '{oops', id: '1' }).ok).toBe(false)
  })

  it('data JSON 但载荷不合法 → ok:false', () => {
    const res = parseSseFrame({ event: 'gate', data: '{"type":"gate"}', id: '2' })
    expect(res.ok).toBe(false)
  })

  it('缺 id → seq 置 -1 仍 ok（缺 id 只影响去重，不视为失败）', () => {
    const data = JSON.stringify(
      baseEvent({ type: 'run.completed', final_node: 'n-done', duration_s: 5, seq: 9 }),
    )
    const res = parseSseFrame({ event: 'run.completed', data })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.event.seq).toBe(-1)
  })
})
