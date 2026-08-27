/**
 * L5 看板线网络层 mock engine server（L5 v0.2，design §13.1——开发/视觉调试专用，
 * 页面代码零分支的网络层替身；演示当天起真 service+引擎，页面不改一行）：
 * 提供 /api/state（登录态）+ /healthz + 引擎 HTTP/SSE 全套（§9.3 契约形状）。
 * 事件数据来自 src/fixtures/scenarios.ts 剧本（引擎线联调对齐锚的同一数据源）。
 * 剧本选择：环境变量 MOCK_SCENARIO（happy-path|gate-pause|reflow|abort，默认 happy-path）；
 * POST tasks 时按当前剧本播流；gate-pause 推到停靠帧自动暂停，confirm-gate 恢复。
 *
 * 用法：bun scripts/mock-engine-server.ts（监听 19990）
 *   VITE_PROXY_TARGET=http://127.0.0.1:19990 bun run --cwd workbench/workbench-web dev -- --port 19986
 */
import { buildScenario, employees, scenarioTable, type ScenarioName } from '../src/fixtures/scenarios'

const PORT = 19990
const FRAME_MS = 300

let scenario: ScenarioName = (process.env.MOCK_SCENARIO as ScenarioName) ?? 'happy-path'
let taskNo = 0
let lastTaskId: string | null = null
/** 待播帧队列（seq 保留） */
let queue: Array<{ event: string; data: string; id: string }> = []
let paused = false
let timer: ReturnType<typeof setInterval> | null = null
/** SSE 订阅者（通常一个页面一条流） */
const subscribers = new Set<(frame: { event: string; data: string; id: string }) => void>()

function frameOf(ev: unknown): { event: string; data: string; id: string } {
  const e = ev as { type: string; seq: number }
  return { event: e.type, data: JSON.stringify(ev), id: String(e.seq) }
}

function broadcast(frame: { event: string; data: string; id: string }): void {
  // 订阅者已断开时 enqueue 抛错——逐个防御并剔除（否则炸掉整个 mock 进程）
  for (const send of subscribers) {
    try {
      send(frame)
    } catch {
      subscribers.delete(send)
    }
  }
}

function pump(): void {
  if (paused) return
  const frame = queue.shift()
  if (!frame) {
    if (timer) clearInterval(timer)
    timer = null
    return
  }
  broadcast(frame)
  // 停靠检测：推到 gate_paused 帧自动暂停（演出停靠；confirm-gate 恢复）
  try {
    const ev = JSON.parse(frame.data) as { type: string; status?: string }
    if (ev.type === 'transition' && ev.status === 'gate_paused') paused = true
  } catch {
    /* 非法帧忽略 */
  }
}

function startPlayback(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(pump, FRAME_MS)
}

function spawnRun(title: string, workspace: string): string {
  taskNo += 1
  // task_id 全局唯一（真实语义：账本持久不复用）——含时间戳后缀防进程重启后
  // 与页面已见任务重号（重号会被消费端 per-task seq 去重误吞）
  const taskId = `R-${taskNo}-${Date.now().toString(36)}`
  lastTaskId = taskId
  const events = buildScenario(scenario, { taskId, title, workspace })
  queue = events.map(frameOf)
  paused = false
  startPlayback()
  return taskId
}

function sseResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      // 连接即发首字节（comment）——防代理/服务端 idleTimeout 对「零字节流」的提前掐断
      controller.enqueue(encoder.encode(`: connected\n\n`))
      const send = (frame: { event: string; data: string; id: string }): void => {
        controller.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${frame.data}\nid: ${frame.id}\n\n`))
      }
      subscribers.add(send)
      // 心跳（§8：15s comment 语义的加密实现——SSE 空闲期保活，防 idle 掐断）
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          clearInterval(ping)
          subscribers.delete(send)
        }
      }, 5000)
    },
    cancel() {
      // 连接断开：订阅清理由心跳 ping 的 catch 兜底（enqueue 对已关流抛错）
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  })
}

const STATE = {
  installationId: 'mock-installation',
  status: 'ACTIVE',
  authenticated: true,
  user: { name: '调试', sub: 'dev' },
  enrollmentId: 'mock',
}

Bun.serve({
  port: PORT,
  idleTimeout: 255, // SSE 长连接保活上限（秒；配合 5s 心跳防空闲掐断）
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/api/state') return Response.json(STATE)
    if (path === '/healthz') return Response.json({ app: 'workbench', status: 'ok', version: '0.0.0-mock' })

    if (path === '/api/engine/stream') return sseResponse()

    if (path === '/api/engine/flows') {
      return Response.json([{ flow: 'demo-flow', display_name: '五阶段演示交付' }])
    }

    if (path === '/api/engine/tasks' && req.method === 'POST') {
      const body = (await req.json()) as { title?: string; workspace?: string }
      const taskId = spawnRun(body.title ?? `演示任务 ${taskNo + 1}`, body.workspace ?? 'D:/demo/workspace')
      return Response.json({ task_id: taskId }, { status: 202 })
    }

    const taskMatch = path.match(/^\/api\/engine\/tasks\/([^/]+)$/)
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1])
      return Response.json({ task: { task_id: taskId, flow: 'demo-flow' }, table: scenarioTable[scenario], employees })
    }

    const gateMatch = path.match(/^\/api\/engine\/tasks\/([^/]+)\/confirm-gate$/)
    if (gateMatch && req.method === 'POST') {
      // 停靠恢复（真实语义=引擎放行续跑）
      paused = false
      if (!timer && queue.length > 0) startPlayback()
      return Response.json({ ok: true })
    }

    return Response.json({ error: { code: 'NOT_FOUND', message: path } }, { status: 404 })
  },
})

console.log(`mock engine server on http://127.0.0.1:${PORT}（剧本=${scenario}，MOCK_SCENARIO 可切换）`)
