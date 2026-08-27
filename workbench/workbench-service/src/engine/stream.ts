/**
 * 引擎 SSE 流（L3 T7）——设计 §8 契约的进程内实现。
 * 帧格式：`event: <type>\ndata: <事件JSON>\nid: <task_id>:<seq>\n\n`（id 复合形式——
 * 多任务订阅下 seq 为 per-task 计数，跨任务不可比，EventSource 重连带复合 id 解析回放）。
 * 心跳 15s `:ping`；断线重连（Last-Event-ID=<task_id>:<seq>）→ 回放该任务 seq 之后存量再接增量。
 * 初值不在本通道：看板首屏经 GET /api/engine/tasks 拉取，SSE 只管增量与显式重放（标准模式）。
 */
import type { Engine, EngineEvent } from '@devzero/engine'

export interface EngineStreamOptions {
  /** 订阅过滤（缺省=全量推送所有任务增量） */
  taskId?: string
  /** 浏览器 EventSource 自动重连带回的 Last-Event-ID（<task_id>:<seq>） */
  lastEventId?: string
  /** 心跳间隔 ms（测试可注入短值；缺省 15000） */
  heartbeatMs?: number
}

/** 解析复合 id `<task_id>:<seq>`；非法/无 → null */
export function parseLastEventId(header: string | undefined): { taskId: string; seq: number } | null {
  if (!header) return null
  const idx = header.lastIndexOf(':')
  if (idx <= 0) return null
  const seq = Number(header.slice(idx + 1))
  if (!Number.isInteger(seq) || seq < 0) return null
  return { taskId: header.slice(0, idx), seq }
}

/** 单事件 → SSE 帧（id 复合形式） */
export function encodeFrame(e: EngineEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\nid: ${e.trace_id}:${e.seq}\n\n`
}

export function createEngineStream(engine: Engine, opts: EngineStreamOptions = {}): ReadableStream<Uint8Array> {
  const heartbeatMs = opts.heartbeatMs ?? 15_000
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // ① 断线重放：Last-Event-ID 指定任务 → 回放该任务 seq 之后存量（先于增量）
      const last = parseLastEventId(opts.lastEventId)
      if (last) {
        try {
          for (const e of engine.readEvents(last.taskId, last.seq)) {
            controller.enqueue(encoder.encode(encodeFrame(e)))
          }
        } catch {
          // 任务不存在/已清理——重放失败不阻塞连接，从增量继续
        }
      }
      // ② 增量订阅（进程内 emitter——零 watcher）
      unsubscribe = engine.onEvent((e) => {
        if (opts.taskId && e.trace_id !== opts.taskId) return
        controller.enqueue(encoder.encode(encodeFrame(e)))
      })
      // ③ 心跳（防代理/网关超时断连）
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(':ping\n\n'))
      }, heartbeatMs)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })
}
