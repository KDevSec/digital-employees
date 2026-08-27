/**
 * MockEventSource（L5 看板线 T3）：EventSourceLike 的 mock 实现——SSE 消费层
 * （engine-stream.ts）与看板 fixture 演出的测试/开发替身。
 * 持帧队列按节奏派发（intervalMs 可配 0 = 即时），支持演出控制（start/pause/resume/drain）
 * 与断线模拟（emitError→CONNECTING / emitOpen→OPEN）、重放模拟（replayFrom）。
 * 只实现消费层依赖的最小面：addEventListener / close / readyState / onopen / onerror。
 */

export interface MockFrame {
  event: string
  data: string
  id?: string
}

type Listener = (ev: { data?: string; lastEventId?: string }) => void

export class MockEventSource {
  readyState = 0 // 0 CONNECTING / 1 OPEN / 2 CLOSED（对齐 EventSource 常量语义）
  onopen: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  readonly url: string

  private readonly listeners = new Map<string, Set<Listener>>()
  private queue: MockFrame[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private pausedFlag = false
  /** 已派发帧（fixture 服务停靠检测/测试取证） */
  readonly emitted: MockFrame[] = []

  constructor(
    url: string,
    private readonly opts: { intervalMs?: number; onFrame?: (frame: MockFrame) => void } = {},
  ) {
    this.url = url
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  /** EventSource 语义：close 后不再派发（消费层 close 清理测试依赖此行为兜底） */
  close(): void {
    this.readyState = 2
    this.stopTimer()
    this.listeners.clear()
  }

  /* ---------------- 演出/测试控制面 ---------------- */

  /** 帧入队（不派发；start/flushAll 时播出） */
  enqueueFrames(frames: MockFrame[]): void {
    this.queue.push(...frames)
  }

  /** 从指定 seq 起重放帧（模拟服务端 Last-Event-ID 回放窗口） */
  replayFrom(seq: number, frames: MockFrame[]): void {
    this.queue.push(...frames.filter((f) => f.id !== undefined && Number(f.id) >= seq))
  }

  /** 按节奏开播（intervalMs=0 时逐帧微任务推进，测试可同步 drain） */
  start(): void {
    if (this.timer) return
    const interval = this.opts.intervalMs ?? 300
    this.timer = setInterval(() => this.pump(1), interval)
  }

  /** 暂停（演出停靠感——gate-pause 剧本的「无事件若干秒」）；队列保留可恢复 */
  pause(): void {
    this.pausedFlag = true
    this.stopTimer()
  }

  /** 恢复播放 */
  resume(): void {
    this.pausedFlag = false
    this.start()
  }

  /** 演出暂停态（pump 循环也尊重此标志——drain 不越过停靠帧） */
  isPaused(): boolean {
    return this.pausedFlag
  }

  /** 同步排干队列（测试用；等价 flushAll） */
  drain(): void {
    this.pump(this.queue.length)
  }

  /** 同步排干队列 */
  flushAll(): void {
    this.pump(this.queue.length)
  }

  /** 立即派发单帧（不经队列） */
  emit(frame: MockFrame): void {
    this.dispatch(frame)
  }

  /** comment 帧（15s 心跳 :ping）——EventSource 语义：不派发给任何 listener */
  emitComment(_text: string): void {
    /* comment 不可见 */
  }

  /** 模拟连接建立 */
  emitOpen(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  /** 模拟断线（原生 EventSource 自动重试——readyState 回 CONNECTING） */
  emitError(): void {
    this.readyState = 0
    this.onerror?.({})
  }

  private pump(count: number): void {
    for (let i = 0; i < count && this.queue.length > 0; i++) {
      if (this.pausedFlag) return
      const frame = this.queue.shift()!
      this.dispatch(frame)
    }
  }

  private dispatch(frame: MockFrame): void {
    this.emitted.push(frame)
    this.opts.onFrame?.(frame)
    const set = this.listeners.get(frame.event)
    if (!set) return
    for (const listener of set) {
      listener({ data: frame.data, lastEventId: frame.id })
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
