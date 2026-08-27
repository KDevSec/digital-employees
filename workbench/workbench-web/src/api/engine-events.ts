/**
 * 引擎事件消费契约（L5 看板线 T1，设计 §3.1；契约真源 = 协同编排设计 §7.3）：
 * 六类事件判别联合 + SSE 帧解析，纯函数、无 DOM 无网络——SSE 订阅层（engine-stream.ts）
 * 与归并层（stores/kanban.ts）共同的数据底座。
 *
 * 外部数据不可信纪律（health.ts 同款）：载荷经 parseEngineEvent 类型守卫逐字段窄化，
 * 不符归一 { ok:false } 不抛异常——消费侧只处理 ok:true；失败帧丢弃（错误串带回字段名便于诊断）。
 * snake_case 字段名对齐 §7.3 原样（1.0 账本兼容），不做 camelCase 转写。
 */

export type EngineEventType =
  | 'run.created'
  | 'run.completed'
  | 'run.aborted'
  | 'transition'
  | 'gate'
  | 'dispatch'

/** 事件通用壳（§7.3：seq=行号 1-based SSE 重放锚；trace_id=task_id；parent_seq=因果链）。
 *  task_id 为派生字段：引擎真实事件载荷只带 trace_id（L5×L3 联调实锤——设计 §7.3 trace_id=task_id），
 *  消费层以 trace_id 兜底注入；L5 fixture 冗余自带 task_id，两者兼容（见 parseEngineEvent 归一）。 */
interface EngineEventBase {
  seq: number
  ts: string
  type: EngineEventType
  trace_id: string
  parent_seq: number | null
  actor: string
  task_id: string
}

export interface RunCreatedEvent extends EngineEventBase {
  type: 'run.created'
  flow: string
  title: string
  workspace: string
  /** 引擎条件展开（表无 display_name 则省略——solo 动态表即无） */
  display_name?: string
}

export interface RunCompletedEvent extends EngineEventBase {
  type: 'run.completed'
  final_node?: string
  duration_s: number
}

export interface RunAbortedEvent extends EngineEventBase {
  type: 'run.aborted'
  final_node?: string
  reason: string
}

/** transition：status = 推进后任务状态快照（in_progress/gate_paused/blocked/completed…） */
export interface TransitionEvent extends EngineEventBase {
  type: 'transition'
  from: string | null
  to: string
  reflow?: boolean
  forced_fail?: boolean
  reason?: string
  status: string
}

/** gate：node = 闸位节点 id（歧义 D 裁决·引擎为准——recordGate 记 state.current_node，
 *  评审时任务已 advance 进闸节点；covers 目标节点不进事件，demo-run-events.jsonl 实证）；
 *  verdict = PASS/FAIL（人工闸 approve/reject） */
export interface GateEvent extends EngineEventBase {
  type: 'gate'
  gate: string
  kind: string
  node: string
  verdict: string
  iter: number
  reviewer: string
  issues?: string[]
  request_id?: string
}

/** dispatch：phase 区分 start/done（§7.3 原生）；done 带 status（引擎取值集 'done'|'blocked'，
 *  歧义 F 落定——HTTP 面 zod enum 同源，routes/engine.ts dispatchDoneSchema） */
export interface DispatchEvent extends EngineEventBase {
  type: 'dispatch'
  phase: 'start' | 'done'
  emp: string
  dispatch_id: string
  node?: string
  status?: string
  usage?: unknown
}

export type EngineEvent =
  | RunCreatedEvent
  | RunCompletedEvent
  | RunAbortedEvent
  | TransitionEvent
  | GateEvent
  | DispatchEvent

export type ParseResult = { ok: true; event: EngineEvent } | { ok: false; error: string }

/* ---------- 微守卫（unknown 逐字段窄化；不抛异常是硬纪律） ---------- */

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number'
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** 通用壳校验：身份锚 trace_id 等字段齐备且类型正确（task_id 不校验——派生字段见 parseEngineEvent） */
function checkBase(raw: Record<string, unknown>): string | null {
  if (!isStr(raw.trace_id)) return 'trace_id'
  if (!isStr(raw.ts)) return 'ts'
  if (!isStr(raw.actor)) return 'actor'
  if (!isNum(raw.seq)) return 'seq'
  if (raw.parent_seq !== null && !isNum(raw.parent_seq)) return 'parent_seq'
  return null
}

/** 已过壳校验的对象 → EngineEvent（载荷逐类窄化；返回错误字段名或 null） */
function payloadError(raw: Record<string, unknown>): string | null {
  switch (raw.type) {
    case 'run.created':
      if (!isStr(raw.flow)) return 'flow'
      if (!isStr(raw.title)) return 'title'
      if (!isStr(raw.workspace)) return 'workspace'
      if (raw.display_name !== undefined && !isStr(raw.display_name)) return 'display_name'
      return null
    case 'run.completed':
      if (raw.final_node !== undefined && !isStr(raw.final_node)) return 'final_node'
      if (!isNum(raw.duration_s)) return 'duration_s'
      return null
    case 'run.aborted':
      if (raw.final_node !== undefined && !isStr(raw.final_node)) return 'final_node'
      if (!isStr(raw.reason)) return 'reason'
      return null
    case 'transition':
      if (raw.from !== null && !isStr(raw.from)) return 'from'
      if (!isStr(raw.to)) return 'to'
      if (!isStr(raw.status)) return 'status'
      if (raw.reflow !== undefined && typeof raw.reflow !== 'boolean') return 'reflow'
      if (raw.forced_fail !== undefined && typeof raw.forced_fail !== 'boolean')
        return 'forced_fail'
      if (raw.reason !== undefined && !isStr(raw.reason)) return 'reason'
      return null
    case 'gate':
      if (!isStr(raw.gate)) return 'gate'
      if (!isStr(raw.kind)) return 'kind'
      if (!isStr(raw.node)) return 'node'
      if (!isStr(raw.verdict)) return 'verdict'
      if (!isNum(raw.iter)) return 'iter'
      if (!isStr(raw.reviewer)) return 'reviewer'
      if (raw.issues !== undefined && !isStrArray(raw.issues)) return 'issues'
      if (raw.request_id !== undefined && !isStr(raw.request_id)) return 'request_id'
      return null
    case 'dispatch':
      if (raw.phase !== 'start' && raw.phase !== 'done') return 'phase'
      if (!isStr(raw.emp)) return 'emp'
      if (!isStr(raw.dispatch_id)) return 'dispatch_id'
      if (raw.node !== undefined && !isStr(raw.node)) return 'node'
      if (raw.status !== undefined && !isStr(raw.status)) return 'status'
      return null
    default:
      return 'type'
  }
}

/**
 * 已解析对象 → EngineEvent 判别联合（守卫矩阵见 test/engine-events.test.ts）。
 * 非对象/壳字段缺失/载荷字段不符 → { ok:false, error: '<字段名> …' }，绝不抛异常。
 * 通过校验后归一 task_id：引擎载荷不带该字段（设计 §7.3 trace_id=task_id，L5×L3 联调
 * 实锤），以 trace_id 兜底注入；fixture 冗余自带 task_id 时保留原值（两者兼容）。
 */
export function parseEngineEvent(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '事件不是对象' }
  const obj = raw as Record<string, unknown>
  const baseErr = checkBase(obj)
  if (baseErr) return { ok: false, error: `字段 ${baseErr} 缺失或类型不符` }
  const payloadErr = payloadError(obj)
  if (payloadErr) return { ok: false, error: `字段 ${payloadErr} 缺失或类型不符` }
  const event = obj as unknown as EngineEvent
  return { ok: true, event: isStr(obj.task_id) ? event : { ...event, task_id: event.trace_id } }
}

/** SSE 帧（§8 契约：event + data + id）；data 为事件 JSON 行，id=seq */
export interface SseFrame {
  event: string
  data: string
  id?: string
}

/**
 * SSE 事件帧 → EngineEvent：JSON.parse 后经 parseEngineEvent 守卫。
 * 未知 event type / 坏 JSON / 载荷不符 → ok:false；缺 id 时事件 seq 置 -1 继续消费
 * （seq 只用于断线重连去重，缺 id 不视为数据失败）。
 */
export function parseSseFrame(frame: SseFrame): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(frame.data)
  } catch {
    return { ok: false, error: `data 非法 JSON（event=${frame.event}）` }
  }
  if (typeof parsed === 'object' && parsed !== null) {
    // 未知 type 先拦（parseEngineEvent 的 default 分支也会拦，此处给出带 type 名的更清晰错误）
    const t = (parsed as Record<string, unknown>).type
    if (t !== frame.event) {
      return { ok: false, error: `data.type(${String(t)}) 与帧 event(${frame.event}) 不一致` }
    }
  }
  const res = parseEngineEvent(parsed)
  if (res.ok && frame.id === undefined) {
    return { ok: true, event: { ...res.event, seq: -1 } }
  }
  return res
}
