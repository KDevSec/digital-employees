/**
 * SSE 消费层（L5 看板线 T3，设计 §4；契约真源 = 协同编排设计 §8）：
 * GET /api/engine/stream 订阅 → 帧按 event type 分发 → EngineEvent 回调 + 连接状态回调。
 *
 * 可注入 EventSourceLike（D-kb01）：jsdom 无 EventSource（测试前提），fixture 演出注入
 * MockEventSource；live 模式默认工厂用全局 EventSource。
 *
 * §8 契约落点：
 * - 订阅粒度：streamUrl() 全量 / streamUrl(taskId) 过滤（事件自带 task_id，store 兜底分拣）；
 * - 心跳 15s `:ping` comment：EventSource 语义天然不进 listener，消费层无需处理；
 * - 断线重连：原生 EventSource 自动重连自动带 Last-Event-ID → 服务端从 seq+1 回放；
 *   本层职责 = readyState/onerror → 'reconnecting'、onopen → 'live'，以及 **seq 去重**
 *   （重放窗口重叠幂等兜底：seq ≤ 已见最大 seq 的帧跳过；seq=-1 无 id 帧不去重）。
 */

import { parseSseFrame, type EngineEvent, type EngineEventType } from './engine-events'

/** 消费层依赖的 EventSource 最小面（MockEventSource 与原生 EventSource 均满足）。
 * listener 事件参数取 MessageEvent 的 data + lastEventId（SSE id: 帧号 = seq 重放锚）。 */
export interface EventSourceLike {
  readyState: number
  onopen: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  addEventListener(type: string, listener: (ev: { data?: string; lastEventId?: string }) => void): void
  close(): void
}

export type SourceFactory = (url: string) => EventSourceLike

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed'

export interface EngineStream {
  /** 六类事件统一出口（已过类型守卫 + seq 去重） */
  onEvent(cb: (ev: EngineEvent) => void): void
  onConnectionChange(cb: (c: Connection) => void): void
  /** 关闭订阅（页面卸载/组件卸载时调用；此后事件不再派发） */
  close(): void
}

/** 订阅 URL（§8：默认全量；?task_id= 可选过滤） */
export function streamUrl(taskId?: string): string {
  return taskId ? `/api/engine/stream?task_id=${encodeURIComponent(taskId)}` : '/api/engine/stream'
}

const EVENT_TYPES: EngineEventType[] = [
  'run.created',
  'run.completed',
  'run.aborted',
  'transition',
  'gate',
  'dispatch',
]

export function createEngineStream(
  url: string,
  opts: { factory?: SourceFactory } = {},
): EngineStream {
  const factory: SourceFactory =
    opts.factory ?? ((u) => new EventSource(u) as unknown as EventSourceLike)
  const source = factory(url)

  let closed = false
  let maxSeq = 0
  let eventCb: ((ev: EngineEvent) => void) | null = null
  let connCb: ((c: Connection) => void) | null = null
  let conn: Connection = 'connecting'

  const notify = (c: Connection): void => {
    conn = c
    connCb?.(c)
  }

  notify('connecting')

  source.onopen = () => {
    if (!closed) notify('live')
  }
  source.onerror = () => {
    if (closed) return
    // readyState 2 = 服务端显式关闭（不可恢复）；0 = 自动重连中
    notify(source.readyState === 2 ? 'closed' : 'reconnecting')
  }

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (frame) => {
      if (closed || frame.data === undefined) return
      const res = parseSseFrame({ event: type, data: frame.data, id: frame.lastEventId })
      if (!res.ok) return // 非法帧静默丢弃（守卫层已记录错误语义）
      const ev = res.event
      if (ev.seq > 0 && ev.seq <= maxSeq) return // 重放去重
      if (ev.seq > 0) maxSeq = ev.seq
      eventCb?.(ev)
    })
  }

  return {
    onEvent(cb) {
      eventCb = cb
    },
    onConnectionChange(cb) {
      connCb = cb
      cb(conn) // 晚注册回放当前态（构造即 connecting，注册在后的订阅者不丢初态）
    },
    close() {
      if (closed) return
      closed = true
      source.close()
      notify('closed')
    },
  }
}
