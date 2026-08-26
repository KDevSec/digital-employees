// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { buildScenario } from '../src/fixtures/scenarios'
import { MockEventSource } from '../src/fixtures/mock-event-source'
import { createEngineStream, streamUrl, type EventSourceLike } from '../src/api/engine-stream'

/**
 * SSE 消费层（L5 看板线 T3，设计 §4；契约真源 = 协同编排设计 §8）：
 * createEngineStream 对 EventSourceLike 编程（可注入——jsdom 无 EventSource，亦是 fixture
 * 先行的结构保证）；帧按 event type 分发、连接状态机（connecting/live/reconnecting/closed）、
 * seq 去重（重放幂等兜底）、comment 心跳不进事件流。
 */

function frameOf(ev: EngineEvent): { event: string; data: string; id: string } {
  return { event: ev.type, data: JSON.stringify(ev), id: String(ev.seq) }
}

describe('MockEventSource（EventSourceLike 的 mock 实现）', () => {
  it('enqueue + flushAll：按 type 派发给对应 listener（帧序保持）', () => {
    const src = new MockEventSource('/api/engine/stream')
    const got: string[] = []
    src.addEventListener('transition', (e) => got.push((e as { data: string }).data))
    src.addEventListener('dispatch', (e) => got.push((e as { data: string }).data))
    const scenario = buildScenario('happy-path', { taskId: 'R-1', title: 't', workspace: 'w' })
    const head = scenario.slice(0, 4).map(frameOf) // run.created + dispatch×2 + transition
    src.enqueueFrames(head)
    src.flushAll()
    expect(got).toHaveLength(3) // transition/dispatch 各自 listener 收到 3 帧，次序一致
    expect(got).toEqual([head[1].data, head[2].data, head[3].data])
  })

  it('comment 帧（:ping 心跳）不派发任何 listener', () => {
    const src = new MockEventSource('/api/engine/stream')
    const got: string[] = []
    src.addEventListener('transition', (e) => got.push('x'))
    src.addEventListener('message', (e) => got.push('x'))
    src.emitComment(':ping')
    expect(got).toHaveLength(0)
  })

  it('emitError：readyState 回 CONNECTING + onerror 触发；open：readyState=1 + onopen 触发', () => {
    const src = new MockEventSource('/api/engine/stream')
    const errs = vi.fn()
    const opens = vi.fn()
    src.onerror = errs
    src.onopen = opens
    src.emitError()
    expect(src.readyState).toBe(0)
    expect(errs).toHaveBeenCalledOnce()
    src.emitOpen()
    expect(src.readyState).toBe(1)
    expect(opens).toHaveBeenCalledOnce()
  })

  it('pause/resume：暂停期间不派发，恢复后续播', () => {
    const src = new MockEventSource('/api/engine/stream', { intervalMs: 0 })
    const got: number[] = []
    for (const t of ['run.created', 'run.completed', 'run.aborted', 'transition', 'gate', 'dispatch']) {
      src.addEventListener(t, (e) => got.push(JSON.parse((e as { data: string }).data).seq))
    }
    const scenario = buildScenario('happy-path', { taskId: 'R-1', title: 't', workspace: 'w' })
    src.enqueueFrames(scenario.map(frameOf))
    src.start()
    src.pause()
    const atPause = got.length
    src.resume()
    src.drain()
    expect(got.length).toBeGreaterThanOrEqual(atPause)
    expect(got.length).toBe(scenario.length)
  })
})

describe('createEngineStream（消费层）', () => {
  it('factory 收到完整 URL（streamUrl 拼接 ?task_id=）；初始状态 connecting', () => {
    const urls: string[] = []
    const got: string[] = []
    const stream = createEngineStream(streamUrl('R-9'), {
      factory: (u) => {
        urls.push(u)
        return new MockEventSource(u)
      },
    })
    stream.onConnectionChange((c) => got.push(c))
    expect(urls).toEqual(['/api/engine/stream?task_id=R-9'])
    expect(got[0]).toBe('connecting')
    stream.close()
  })

  it('open → live；error → reconnecting；close() → closed 且不再派发', () => {
    const src = new MockEventSource(streamUrl())
    const stream = createEngineStream(streamUrl(), { factory: () => src })
    const conns: string[] = []
    const evts: string[] = []
    stream.onConnectionChange((c) => conns.push(c))
    stream.onEvent((e) => evts.push(e.type))
    src.emitOpen()
    src.emitError()
    const scenario = buildScenario('abort', { taskId: 'R-2', title: 't', workspace: 'w' })
    src.enqueueFrames(scenario.slice(0, 2).map(frameOf))
    stream.close()
    src.flushAll() // close 后 mock 仍派发——消费层必须吞掉
    expect(conns).toEqual(['connecting', 'live', 'reconnecting', 'closed'])
    expect(evts).toHaveLength(0)
  })

  it('六类事件帧依序派发；解析失败的帧静默丢弃不炸回调链', () => {
    const src = new MockEventSource(streamUrl())
    const stream = createEngineStream(streamUrl(), { factory: () => src })
    const evts: EngineEvent[] = []
    stream.onEvent((e) => evts.push(e))
    src.emitOpen()
    const scenario = buildScenario('happy-path', { taskId: 'R-3', title: 't', workspace: 'w' })
    src.enqueueFrames(scenario.map(frameOf))
    src.enqueueFrames([
      { event: 'gate', data: '{"broken"', id: '99' }, // 坏 JSON
      { event: 'heartbeat', data: '{}', id: '100' }, // 未知 type
    ])
    src.flushAll()
    expect(evts.map((e) => e.seq)).toEqual(scenario.map((_, i) => i + 1))
    expect(evts.every((e) => e.task_id === 'R-3')).toBe(true)
    stream.close()
  })

  it('seq 去重：重放已见 seq（Last-Event-ID 回放窗口重叠）不重复派发', () => {
    const src = new MockEventSource(streamUrl())
    const stream = createEngineStream(streamUrl(), { factory: () => src })
    const seqs: number[] = []
    stream.onEvent((e) => seqs.push(e.seq))
    src.emitOpen()
    const scenario = buildScenario('happy-path', { taskId: 'R-4', title: 't', workspace: 'w' })
    // 首轮收到前 6 帧，随后「断线重连」——服务端从 seq 3 回放
    src.enqueueFrames(scenario.slice(0, 6).map(frameOf))
    src.flushAll()
    src.emitError()
    src.emitOpen()
    src.enqueueFrames(scenario.slice(2).map(frameOf))
    src.flushAll()
    expect(seqs).toEqual(scenario.map((_, i) => i + 1))
    stream.close()
  })

  it('订阅粒度：streamUrl() 全量 / streamUrl(id) 带过滤参数（§8 契约）', () => {
    expect(streamUrl()).toBe('/api/engine/stream')
    expect(streamUrl('R-5')).toBe('/api/engine/stream?task_id=R-5')
  })

  it('默认工厂用全局 EventSource（live 模式接线的前提）', async () => {
    const calls: string[] = []
    const FakeES = class implements EventSourceLike {
      readyState = 0
      onopen: ((ev: unknown) => void) | null = null
      onerror: ((ev: unknown) => void) | null = null
      constructor(public url: string) {
        calls.push(url)
      }
      addEventListener(): void {}
      close(): void {}
    }
    const orig = (globalThis as { EventSource?: unknown }).EventSource
    ;(globalThis as { EventSource?: unknown }).EventSource = FakeES
    try {
      const stream = createEngineStream(streamUrl('R-6'))
      stream.close()
      expect(calls).toEqual(['/api/engine/stream?task_id=R-6'])
    } finally {
      ;(globalThis as { EventSource?: unknown }).EventSource = orig
    }
  })
})
