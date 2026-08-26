/**
 * 引擎 SSE 流（L3 T7）——设计 §8 契约 + id 复合形式修订（<task_id>:<seq>，执行期裁决落档）。
 * 真实 Engine（临时目录）驱动：帧逐字节断言 / Last-Event-ID 重放 / 心跳（fake timers）/ task_id 过滤。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '@devzero/engine'
import { createEngineStream, encodeFrame, parseLastEventId } from '../src/engine/stream'
import type { EngineEvent } from '@devzero/engine'

const ENGINE_ASSETS = fileURLToPath(new URL('../../workbench-engine/assets/flows', import.meta.url))

let root: string
let engine: Engine
let workspace: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engine-stream-'))
  const flows = join(root, 'flows')
  mkdirSync(flows, { recursive: true })
  copyFileSync(join(ENGINE_ASSETS, 'demo-flow.node-table.yml'), join(flows, 'demo-flow.node-table.yml'))
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flows })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 收流到字符串：读满 maxChunks 或 idleMs 无新块即停（SSE 长连接无 done——不能等尽）；cancel 收尾 */
async function drain(stream: ReadableStream<Uint8Array>, maxChunks = 50, idleMs = 400): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (let i = 0; i < maxChunks; i++) {
    const next = await Promise.race([
      reader.read(),
      new Promise<symbol>((r) => setTimeout(() => r(IDLE), idleMs)),
    ])
    if (next === IDLE) break
    const { done, value } = next
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  await reader.cancel()
  return out
}
const IDLE = Symbol('idle')

const createDemo = (title: string) =>
  engine.createTask({ mode: 'team', flow: 'demo-flow', workspace, title, input: 'x' })

describe('SSE · 帧格式与增量推送', () => {
  it('订阅后事件按落盘序推送：event/data/id 三段帧（id=<task>:<seq> 复合）', async () => {
    const stream = createEngineStream(engine)
    const { task_id } = createDemo('T1') // run.created（订阅在先——增量即收）
    const out = await drain(stream, 8)
    expect(out).toContain('event: run.created\n')
    expect(out).toContain(`"trace_id":"${task_id}"`)
    expect(out).toMatch(new RegExp(`id: ${task_id}:1\\n\\n`))
  })

  it('encodeFrame/parseLastEventId 纯函数往返', () => {
    const e = { seq: 12, ts: 't', type: 'transition', trace_id: 't-abc', parent_seq: null, actor: 'a', flow: 'f' } as unknown as EngineEvent
    const frame = encodeFrame(e)
    expect(frame).toBe(`event: transition\ndata: ${JSON.stringify(e)}\nid: t-abc:12\n\n`)
    expect(parseLastEventId('t-abc:12')).toEqual({ taskId: 't-abc', seq: 12 })
    expect(parseLastEventId('t-abc')).toBeNull()
    expect(parseLastEventId('t-abc:x')).toBeNull()
    expect(parseLastEventId(undefined)).toBeNull()
  })
})

describe('SSE · 断线重放（Last-Event-ID）', () => {
  it('lastEventId=<task>:1 → 先回放该任务 seq>1 存量，再接订阅后增量', async () => {
    const { task_id } = createDemo('T1')
    engine.advance(task_id, 'n0-req') // 存量 2 条：run.created(1) + transition(2)

    const stream = createEngineStream(engine, { lastEventId: `${task_id}:1` })
    engine.advance(task_id, 'g-req-review') // 订阅后增量（transition seq=3）
    const out = await drain(stream, 8)

    // 回放段：seq=2 的 transition 帧（不含 seq=1）
    expect(out).toContain(`id: ${task_id}:2\n`)
    expect(out).not.toContain(`id: ${task_id}:1\n`)
    // 增量段：seq=3
    expect(out).toContain(`id: ${task_id}:3\n`)
    // 帧序：2 在 3 前
    expect(out.indexOf(`${task_id}:2`)).toBeLessThan(out.indexOf(`${task_id}:3`))
  })

  it('重放目标任务不存在 → 不阻塞连接（静默跳过，增量照收）', async () => {
    const stream = createEngineStream(engine, { lastEventId: 't-ghost:5' })
    const { task_id } = createDemo('T2')
    const out = await drain(stream, 4)
    expect(out).toContain(`id: ${task_id}:1\n`)
  })
})

describe('SSE · 心跳与过滤', () => {
  it('heartbeatMs 心跳 :ping 帧（真实短间隔 20ms）', async () => {
    const stream = createEngineStream(engine, { heartbeatMs: 20 })
    await new Promise((r) => setTimeout(r, 120)) // ≥5 拍节拍
    const out = await drain(stream, 6, 200)
    expect(out.split(':ping\n\n').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('?task_id= 过滤：他任务事件不推', async () => {
    const a = createDemo('A')
    const b = createDemo('B')
    const stream = createEngineStream(engine, { taskId: a.task_id })
    engine.advance(b.task_id, 'n0-req') // B 的事件——应被过滤
    const out = await drain(stream, 4)
    expect(out).not.toContain(`"trace_id":"${b.task_id}"`)
  })
})
