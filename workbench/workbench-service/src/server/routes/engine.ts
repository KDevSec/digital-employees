/**
 * engine 域路由（L3 T6）——编排引擎 HTTP API（设计 §9.3）。
 * 真实计算在 @devzero/engine 的 Engine 类（经 deps 注入）；本域只做
 * 薄转发 + zod 入参校验 + 错误契约（{ok:false,error,detail} + 4xx）。
 * 路径参数（:id）从 ctx.path 解析（registry 无参数路由机制）。
 */
import { z } from 'zod'
import type { Ctx, Res, RouteRegistry } from '../registry'

/** engine 域依赖：引擎实例（main 装配：dataDir=profileDir / templatesDir=profileDir/templates/flows） */
export interface EngineRouteDeps {
  engine: {
    createTask(input: unknown): { task_id: string }
    getTask(taskId: string): unknown
    nextStep(taskId: string): unknown
    advance(taskId: string, to: string, opts?: unknown): unknown
    recordGate(taskId: string, g: unknown): unknown
    dispatchStart(taskId: string, p: unknown): { dispatch_id: string }
    dispatchDone(taskId: string, p: unknown): unknown
    handoffWrite(taskId: string, p: unknown): { path: string }
    confirmGate(taskId: string, p: unknown): unknown
    completeTask(taskId: string, status?: 'completed' | 'aborted'): unknown
    getTable(taskId: string): unknown
    readEvents(taskId: string, afterSeq?: number): unknown[]
    listTasks(): { task_id: string; status: string; title: string }[]
    listArchivedTasks(): { task_id: string; status: string; title: string }[]
    flowsList(): { flow: string; file: string }[]
  }
}

// ---------- zod 入参 schema（与 engine 包 CreateTaskInput/各操作入参同形） ----------

const createTaskSchema = z.object({
  mode: z.enum(['team', 'solo']),
  flow: z.string().optional(),
  employee: z.string().optional(),
  workspace: z.string().min(1),
  title: z.string().min(1),
  input: z.string(),
  base: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
}).strict()

const advanceSchema = z.object({
  to: z.string().min(1), reflow: z.boolean().optional(), reason: z.string().optional(), actor: z.string().optional(),
}).strict()

const recordGateSchema = z.object({
  gate: z.string().min(1), verdict: z.string().min(1), by: z.string().min(1),
  issues: z.array(z.string()).optional(), request_id: z.string().optional(),
}).strict()

const dispatchStartSchema = z.object({
  emp: z.string().min(1), node: z.string().optional(), prompt: z.string().optional(),
}).strict()

const dispatchDoneSchema = z.object({
  emp: z.string().min(1), dispatch_id: z.string().min(1),
  status: z.enum(['done', 'blocked']).optional(), usage: z.record(z.number()).optional(),
}).strict()

const handoffWriteSchema = z.object({
  emp: z.string().min(1), node: z.string().min(1), summary: z.string().min(1),
  artifacts: z.array(z.string()).optional(),
  status: z.enum(['done', 'blocked', 'needs_context']).optional(), reason: z.string().optional(),
}).strict()

const confirmGateSchema = z.object({
  node: z.string().min(1), verdict: z.enum(['approve', 'reject']), note: z.string().optional(),
}).strict()

const completeSchema = z.object({ status: z.enum(['completed', 'aborted']).optional() }).strict()

// ---------- 工具 ----------

const badRequest = (detail: string): Res => ({ status: 400, json: { ok: false, error: 'bad_request', detail } })
const notFound = (taskId: string): Res => ({ status: 404, json: { ok: false, error: 'task_not_found', detail: `任务不存在: ${taskId}` } })

/** engine 域错误契约：EngineError/LedgerError → 4xx {ok:false,error,detail}；task 语义 404、其余 400 */
function engineErrorRes(err: unknown): Res {
  const message = err instanceof Error ? err.message : String(err)
  const status = /不存在|缺失|not found/i.test(message) ? 404 : 400
  return { status, json: { ok: false, error: 'engine_error', detail: message } }
}

/** 解析 /api/engine/tasks/<id> 与子动作：<id> 段后可选 /<action> */
function parseTaskPath(path: string): { taskId: string; action?: string } | null {
  const m = path.match(/^\/api\/engine\/tasks\/([^/]+)(?:\/([a-z-]+))?\/?$/)
  return m ? { taskId: m[1], ...(m[2] ? { action: m[2] } : {}) } : null
}

/** zod 解析 + 统一 400；成功返回 data 与窄化 handler */
function parseBody<T>(ctx: Ctx, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; res: Res } {
  const parsed = schema.safeParse(ctx.body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, res: badRequest(`${first.path.join('.') || '(root)'}: ${first.message}`) }
  }
  return { ok: true, data: parsed.data }
}

// ---------- 端点 ----------

export function registerEngineRoutes(reg: RouteRegistry, deps: EngineRouteDeps): void {
  const { engine } = deps

  reg.post('/api/engine/tasks', (ctx) => {
    const parsed = parseBody(ctx, createTaskSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 202, json: { ok: true, ...engine.createTask(parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.get('/api/engine/tasks', () => {
    try {
      return { status: 200, json: { ok: true, tasks: engine.listTasks(), archived: engine.listArchivedTasks() } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.get('/api/engine/flows', () => {
    try {
      return { status: 200, json: { ok: true, flows: engine.flowsList() } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.get('/api/engine/tasks/:id', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action) return notFound(ctx.path)
    try {
      return { status: 200, json: { ok: true, task: engine.getTask(p.taskId) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.get('/api/engine/tasks/:id/events', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'events') return notFound(ctx.path)
    const after = Number(ctx.query?.get('after_seq') ?? '0')
    try {
      return { status: 200, json: { ok: true, events: engine.readEvents(p.taskId, Number.isFinite(after) && after >= 0 ? after : 0) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/advance', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'advance') return notFound(ctx.path)
    const parsed = parseBody(ctx, advanceSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, task: engine.advance(p.taskId, parsed.data.to, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/record-gate', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'record-gate') return notFound(ctx.path)
    const parsed = parseBody(ctx, recordGateSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, task: engine.recordGate(p.taskId, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/dispatch-start', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'dispatch-start') return notFound(ctx.path)
    const parsed = parseBody(ctx, dispatchStartSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, ...engine.dispatchStart(p.taskId, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/dispatch-done', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'dispatch-done') return notFound(ctx.path)
    const parsed = parseBody(ctx, dispatchDoneSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, task: engine.dispatchDone(p.taskId, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/handoff-write', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'handoff-write') return notFound(ctx.path)
    const parsed = parseBody(ctx, handoffWriteSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, ...engine.handoffWrite(p.taskId, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/confirm-gate', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'confirm-gate') return notFound(ctx.path)
    const parsed = parseBody(ctx, confirmGateSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, task: engine.confirmGate(p.taskId, parsed.data) } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/complete', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'complete') return notFound(ctx.path)
    const parsed = parseBody(ctx, completeSchema)
    if (!parsed.ok) return parsed.res
    try {
      return { status: 200, json: { ok: true, task: engine.completeTask(p.taskId, parsed.data.status ?? 'completed') } }
    } catch (err) { return engineErrorRes(err) }
  })

  reg.post('/api/engine/tasks/:id/abort', (ctx) => {
    const p = parseTaskPath(ctx.path)
    if (!p || p.action !== 'abort') return notFound(ctx.path)
    try {
      return { status: 200, json: { ok: true, task: engine.completeTask(p.taskId, 'aborted') } }
    } catch (err) { return engineErrorRes(err) }
  })
}
