// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFixtureRuntime } from '../src/fixtures/kanban-fixture-service'
import type { EngineEvent } from '../src/api/engine-events'
import { parseEngineEvent } from '../src/api/engine-events'

/**
 * fixture 运行时（L5 看板线 T9，设计 §6.4）：mock HTTP + mock SSE + 演出控制。
 * createTask → 202 形状 + 剧本入队自动开播；getTask 下发表/员工映射（契约歧义 A/B 口径）；
 * gate-pause 剧本到停靠帧自动 pause、confirmGate resume（演出闭环）。
 */

function frameEvents(src: MockSrc): EngineEvent[] {
  return src.emitted
    .map((f) => parseEngineEvent(JSON.parse(f.data)))
    .filter((r): r is { ok: true; event: EngineEvent } => r.ok)
    .map((r) => r.event)
}

interface MockSrc {
  emitted: Array<{ event: string; data: string; id?: string }>
}

describe('createFixtureRuntime（fixture 服务）', () => {
  it('createTask：202 形状 {task_id}（R- 前缀递增）', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    const a = await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: '任务A', workspace: 'D:/a', input: 'x' })
    const b = await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: '任务B', workspace: 'D:/b', input: 'y' })
    expect(a.task_id).toMatch(/^R-/)
    expect(b.task_id).not.toBe(a.task_id)
  })

  it('getTask：table + employees 下发（gate-pause 剧本对应变体表）', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    rt.controls.setScenario('gate-pause')
    const { task_id } = await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: 't', workspace: 'D:/w', input: 'x' })
    const detail = await rt.api.getTask(task_id)
    expect(detail.table.nodes.find((n) => n.id === 'n0-req')?.human_gate).toBe(true)
    expect(detail.employees['sec-compliance']).toBe('安全合规审核员')
    expect(detail.task.task_id).toBe(task_id)
  })

  it('getFlows：demo-flow 清单', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    const flows = await rt.api.getFlows()
    expect(flows.map((f) => f.flow)).toContain('demo-flow')
  })

  it('streamFactory：同 runtime 内共享 MockEventSource；createTask 后剧本帧推入流', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    const src = rt.openMockSource()
    expect(rt.openMockSource()).toBe(src)
    const { task_id } = await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: 't', workspace: 'D:/w', input: 'x' })
    rt.controls.drain()
    const events = frameEvents(src as unknown as MockSrc)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('run.created')
    expect(events.every((e) => e.task_id === task_id)).toBe(true)
  })

  it('gate-pause 演出闭环：停靠帧后自动暂停；confirmGate 恢复推流', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    rt.controls.setScenario('gate-pause')
    const src = rt.openMockSource()
    await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: 't', workspace: 'D:/w', input: 'x' })
    rt.controls.drain()
    const paused = (src as unknown as MockSrc).emitted.some(
      (f) => JSON.parse(f.data).type === 'transition' && JSON.parse(f.data).status === 'gate_paused',
    )
    expect(paused).toBe(true)
    expect(rt.controls.isPaused()).toBe(true)
    await rt.api.confirmGate('R-any', 'n0-req', 'approve')
    expect(rt.controls.isPaused()).toBe(false)
  })

  it('controls：setScenario 切剧本 / replayLast 再演一遍（新 run 同剧本）', async () => {
    const rt = createFixtureRuntime({ intervalMs: 0 })
    rt.controls.setScenario('abort')
    const { task_id } = await rt.api.createTask({ mode: 'team', flow: 'demo-flow', title: 't', workspace: 'D:/w', input: 'x' })
    const src = rt.openMockSource()
    rt.controls.drain()
    const first = frameEvents(src as unknown as MockSrc).length
    expect(frameEvents(src as unknown as MockSrc).at(-1)?.type).toBe('run.aborted')
    rt.controls.replayLast()
    rt.controls.drain()
    const events = frameEvents(src as unknown as MockSrc)
    expect(events.length).toBeGreaterThan(first)
    expect(rt.controls.lastTaskId()).not.toBe(task_id) // 再演 = 新 run（同 taskId 重推会被 seq 去重吞掉）
  })
})
