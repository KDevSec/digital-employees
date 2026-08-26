/**
 * 引擎门面（T5）——11 操作 API 面 + 事件 emitter（SSE/驱动器订阅源）。
 * 契约真源：docs/plans/2026-08-26-l3-engine.md「全局类型契约」段 + 设计文档 §9（API 面）。
 *
 * 组合：schema（T1 表加载校验）× R2 节点机（T2）× R3 gate（T3）× R1 账本（T4）。
 * 串行前提：本类不做并发控制——单 service 进程内调用方（HTTP/MCP/驱动器）保证串行
 * （D-041 确定性驱动器单循环；账本 write 为 read-modify-write）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { parseNodeTable, type FlowNode, type GateSpec, type NodeKind, type NodeTable } from './schema/node-table'
import type { EngineEvent } from './schema/events'
import type { TaskState } from './r2/state'
import {
  advance as r2Advance, getNextActions, loadNodeTable, position,
  type LoadedTable,
} from './r2/node-machine'
import { makeGateResult, recordGate as r3RecordGate } from './r3/gate'
import { createLedger, LedgerError, type CreateTaskInput, type Ledger } from './r1/ledger'
import { taskDir, type EngineDirs, type TaskMeta } from './r1/paths'

export type { CreateTaskInput } from './r1/ledger'
export type { EngineDirs } from './r1/paths'

/** 门面错误（表加载失败/非法状态转换请求/归档任务操作等——message 含定位） */
export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

export interface TaskView {
  task_id: string
  flow: string
  title: string
  workspace: string
  status: 'in_progress' | 'gate_paused' | 'blocked' | 'completed' | 'aborted'
  current_node: string | null
  gate_iters: Record<string, number>
  gate_calls: number
  retries: Record<string, number>
  blocked_reason: string | null
  position?: { cleared: number; total: number; pct: number }
}

export interface NextStepView {
  current_node: string | null
  node_kind: NodeKind | null
  node_name: string | null
  emp?: string
  prompt?: string
  next_actions: { to_node: string; label: string }[]
  gate_spec?: GateSpec & { gate: string; current_iter: number; max_retries: number }
  is_blocked: boolean
  blocked_reason: string | null
}

export class Engine {
  private ledger: Ledger
  private listeners: Array<(e: EngineEvent) => void> = []

  constructor(private deps: EngineDirs) {
    this.ledger = createLedger(deps)
  }

  /** 订阅事件流（SSE/驱动器消费）；返回退订函数。事件按落盘顺序（seq 序）分发 */
  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  // ---------- 11 操作（契约 §9.1） ----------

  /** 发起任务：team=从 templatesDir 读表；solo=动态单节点表。落账本+快照+run.created */
  createTask(input: CreateTaskInput): { task_id: string } {
    const table = input.mode === 'solo' ? this.buildSoloTable(input) : this.loadFlowTemplate(input.flow!)
    const { task_id } = this.ledger.init(input, table)
    const { state } = this.ledger.read(task_id)
    this.commit(task_id, state, [{
      seq: 0, ts: '', type: 'run.created', trace_id: task_id, parent_seq: null,
      actor: 'human', flow: table.flow,
      title: input.title, workspace: input.workspace,
      ...(table.display_name !== undefined ? { display_name: table.display_name } : {}),
    }])
    return { task_id }
  }

  getTask(taskId: string): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    return this.toView(meta, state, taskId)
  }

  /** 当前节点+可执行动作+gate_spec；action 节点透传 emp 与渲染后的 prompt */
  nextStep(taskId: string): NextStepView {
    const { state, meta } = this.ledger.read(taskId)
    const table = this.loadedTable(taskId, meta)
    const base = getNextActions(state, table)
    const node = state.current_node ? table.nodeMap.get(state.current_node) : undefined
    return {
      ...base,
      // 人工闸停靠 = 等人放行（confirmGate），不再给推进动作（停靠语义属引擎层，R2 纯转移不感知）
      ...(state.status === 'gate_paused' ? { next_actions: [] as { to_node: string; label: string }[] } : {}),
      emp: node?.emp,
      prompt: node?.prompt !== undefined ? renderPrompt(node.prompt, meta) : undefined,
    }
  }

  advance(taskId: string, to: string, opts: { reflow?: boolean; reason?: string; actor?: string } = {}): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    const table = this.loadedTable(taskId, meta)
    let next: TaskState
    try {
      next = r2Advance(state, to, { table, reflow: opts.reflow, reason: opts.reason })
    } catch (err) {
      throw this.wrapR2(err, taskId)
    }
    this.settleHumanGate(next, table)
    // forced_fail 推断：reflow 溢出才被改投 terminal_fail（R2 内部语义，见 node-machine bounded reflow）
    const forcedFail = opts.reflow === true && next.current_node === table.terminal_fail
    this.commit(taskId, next, [{
      seq: 0, ts: '', type: 'transition', trace_id: taskId, parent_seq: null,
      actor: opts.actor ?? 'engine', flow: meta.flow,
      from: state.current_node ?? undefined, to: next.current_node ?? undefined,
      reflow: opts.reflow === true, forced_fail: forcedFail,
      reason: opts.reason ?? undefined, status: next.status,
    }])
    return this.getTask(taskId)
  }

  recordGate(taskId: string, g: {
    gate: string; verdict: string; by: string; issues?: string[]; request_id?: string;
  }): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    const table = this.loadedTable(taskId, meta)
    const spec = table.gate_specs[g.gate]
    if (!spec) throw new EngineError(`[engine] 未知 gate '${g.gate}'（task ${taskId}）`)
    const requestId = g.request_id ?? `r-${g.gate}-${state.gate_calls + 1}`
    const gr = makeGateResult({
      gate: g.gate, kind: spec.kind, node: state.current_node ?? null,
      verdict: g.verdict, request_id: requestId, by: g.by, issues: g.issues,
    })
    let next: TaskState
    try {
      next = r3RecordGate(state, gr, { table })
    } catch (err) {
      throw this.wrapR3(err, taskId)
    }
    this.settleHumanGate(next, table)
    // R3 内部的推进同样发 transition 事件（节点移动必须留痕——看板 chips 消费）；R3 回流 reflow=false（两套溢出语义）
    const events: EngineEvent[] = [{
      seq: 0, ts: '', type: 'gate', trace_id: taskId, parent_seq: null,
      actor: g.by, flow: meta.flow,
      gate: g.gate, kind: spec.kind, node: state.current_node ?? undefined,
      verdict: g.verdict, iter: gr.iter ?? 1, reviewer: g.by,
      issues: g.issues ?? [], request_id: requestId,
    }]
    if (next.current_node !== state.current_node) {
      events.push({
        seq: 0, ts: '', type: 'transition', trace_id: taskId, parent_seq: null,
        actor: g.by, flow: meta.flow,
        from: state.current_node ?? undefined, to: next.current_node ?? undefined, reflow: false, forced_fail: false,
        reason: `${g.gate} ${g.verdict}`, status: next.status,
      })
    }
    this.commit(taskId, next, events)
    return this.getTask(taskId)
  }

  dispatchStart(taskId: string, p: { emp: string; node?: string; prompt?: string }): { dispatch_id: string } {
    const { state, meta } = this.ledger.read(taskId)
    const events = this.ledger.readEvents(taskId)
    const count = events.filter((e) => e.type === 'dispatch' && e.phase === 'start').length
    const dispatchId = `d-${count + 1}`
    // 因果链：上一段 dispatch.done（无则 run.created）为父。
    // prompt 不进事件流（事件载荷无此键——派发内容经 spawn runner 直接消费，事件只记 node/emp）
    const parent = [...events].reverse().find((e) => e.type === 'dispatch' && e.phase === 'done') ?? events[0]
    void p.prompt
    this.commit(taskId, state, [{
      seq: 0, ts: '', type: 'dispatch', trace_id: taskId, parent_seq: parent ? parent.seq : null,
      actor: 'driver', flow: meta.flow,
      phase: 'start', emp: p.emp, dispatch_id: dispatchId,
      node: p.node ?? state.current_node ?? undefined,
    }])
    return { dispatch_id: dispatchId }
  }

  dispatchDone(taskId: string, p: {
    emp: string; dispatch_id: string; status?: 'done' | 'blocked'; usage?: Record<string, number>;
  }): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    this.commit(taskId, state, [{
      seq: 0, ts: '', type: 'dispatch', trace_id: taskId, parent_seq: null,
      actor: p.emp, flow: meta.flow,
      phase: 'done', emp: p.emp, dispatch_id: p.dispatch_id,
      node: state.current_node ?? undefined, status: p.status ?? 'done',
      ...(p.usage !== undefined ? { usage: p.usage } : {}),
    }])
    return this.getTask(taskId)
  }

  /** 写交接产物摘要（handoffs/<emp>/<node>.handoff.json——1.0 write_handoff_status 对应）；仅活动任务 */
  handoffWrite(taskId: string, p: {
    emp: string; node: string; summary: string; artifacts?: string[];
    status?: 'done' | 'blocked' | 'needs_context'; reason?: string;
  }): { path: string } {
    const { state, meta } = this.ledger.read(taskId)
    const dir = taskDir(meta.workspace, taskId)
    if (!existsSync(dir)) {
      throw new EngineError(`[engine] handoffWrite 仅限活动任务（task ${taskId} 已归档或目录缺失: ${dir}）`)
    }
    const path = join(dir, 'handoffs', p.emp, `${p.node}.handoff.json`)
    mkdirSync(join(dir, 'handoffs', p.emp), { recursive: true })
    const payload = {
      node_id: p.node, employee: p.emp, status: p.status ?? 'done', summary: p.summary,
      artifacts: p.artifacts ?? [], reason: p.reason ?? null,
      gate_input: null as string | null, ts: new Date().toISOString(),
    }
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`)
    return { path }
  }

  /** 人工闸放行：approve → gate 事件(PASS, by=human) + advance 后继；reject → gate 事件(FAIL) + 原地恢复 in_progress */
  confirmGate(taskId: string, p: { node: string; verdict: 'approve' | 'reject'; note?: string }): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    const table = this.loadedTable(taskId, meta)
    if (state.status !== 'gate_paused') {
      throw new EngineError(`[engine] confirmGate 仅在 gate_paused 状态可用（task ${taskId} 当前 ${state.status}）`)
    }
    if (state.current_node !== p.node) {
      throw new EngineError(`[engine] 停靠节点不符（task ${taskId} 停在 '${state.current_node}'，请求 '${p.node}'）`)
    }
    const requestId = `confirm:${p.node}`
    if (p.verdict === 'approve') {
      const node = table.nodeMap.get(p.node)!
      const to = node.next[0] // V0.1：人工闸单后继（demo 全形态）；多后继留表演进
      let next: TaskState
      try {
        next = r2Advance(state, to, { table, reason: p.note ?? '人工放行' })
      } catch (err) {
        throw this.wrapR2(err, taskId)
      }
      // 放行先恢复运行态（R2 只动 current_node，status 仍继承 gate_paused），再判落点是否又停靠
      next.status = 'in_progress'
      this.settleHumanGate(next, table)
      this.commit(taskId, next, [
        {
          seq: 0, ts: '', type: 'gate', trace_id: taskId, parent_seq: null,
          actor: 'human', flow: meta.flow,
          gate: `human:${p.node}`, kind: 'review', node: p.node,
          verdict: 'PASS', iter: 1, reviewer: 'human',
          issues: [], request_id: requestId,
        },
        {
          seq: 0, ts: '', type: 'transition', trace_id: taskId, parent_seq: null,
          actor: 'human', flow: meta.flow,
          from: p.node, to: next.current_node ?? undefined, reflow: false, forced_fail: false,
          reason: p.note ?? '人工放行', status: next.status,
        },
      ])
      return this.getTask(taskId)
    }
    // reject：记录 FAIL 事件 + 原地恢复 in_progress（人/驱动器后续处置）
    this.commit(taskId, { ...state, status: 'in_progress', blocked_reason: null }, [{
      seq: 0, ts: '', type: 'gate', trace_id: taskId, parent_seq: null,
      actor: 'human', flow: meta.flow,
      gate: `human:${p.node}`, kind: 'review', node: p.node,
      verdict: 'FAIL', iter: 1, reviewer: 'human',
      issues: [], request_id: requestId,
    }])
    return this.getTask(taskId)
  }

  completeTask(taskId: string, status: 'completed' | 'aborted' = 'completed'): TaskView {
    const { state, meta } = this.ledger.read(taskId)
    if (state.status === 'completed' || state.status === 'aborted') {
      throw new EngineError(`[engine] 任务已是终态（task ${taskId} ${state.status}）`)
    }
    const duration_s = Math.max(0, Math.round((Date.now() - Date.parse(meta.created_at)) / 1000))
    const next: TaskState = { ...state, status }
    this.commit(taskId, next, [{
      seq: 0, ts: '', type: status === 'completed' ? 'run.completed' : 'run.aborted', trace_id: taskId,
      parent_seq: null, actor: 'engine', flow: meta.flow,
      final_node: state.current_node ?? undefined, ...(status === 'completed' ? { duration_s } : { reason: 'aborted' }),
    }])
    const view = this.toView(meta, next, taskId) // 归档前组装（归档后快照目录移走，position 会缺省）
    this.ledger.archive(taskId)
    return view
  }

  /** 读 run 级表快照（parseNodeTable 再校验——防手改坏；仅活动任务目录形态） */
  getTable(taskId: string): NodeTable {
    const { meta } = this.ledger.read(taskId)
    return this.snapshotTable(taskId, meta)
  }

  /** 事件拉取（SSE 重放/HTTP 分页共用；归档任务可读历史） */
  readEvents(taskId: string, afterSeq = 0): EngineEvent[] {
    return this.ledger.readEvents(taskId, afterSeq)
  }

  // ---------- 内部 ----------

  /** 统一提交：ledger.write（seq/ts 注入）→ 读回实际事件 → 按序 emit */
  private commit(taskId: string, next: TaskState, events: EngineEvent[]): void {
    const before = this.ledger.readEvents(taskId).length
    this.ledger.write(taskId, next, events)
    const written = this.ledger.readEvents(taskId, before)
    for (const e of written) {
      for (const l of this.listeners) l(e)
    }
  }

  /** 落点 human_gate 停靠：advance/recordGate 落到 human_gate=true 节点 → status=gate_paused */
  private settleHumanGate(state: TaskState, table: LoadedTable): void {
    if (state.status !== 'in_progress') return
    const landed = state.current_node ? table.nodeMap.get(state.current_node) : undefined
    if (landed?.human_gate === true) {
      state.status = 'gate_paused'
    }
  }

  private loadFlowTemplate(flow: string): NodeTable {
    const p = join(this.deps.templatesDir, `${flow}.node-table.yml`)
    if (!existsSync(p)) {
      throw new EngineError(`[engine] flow 模板不存在: ${p}（GET /api/engine/flows 可列可用表）`)
    }
    return parseNodeTable(yamlLoad(readFileSync(p, 'utf8')))
  }

  /** solo 动态表：单 action（emp=选定员工，prompt={{input}}）+ 成功/失败 terminal */
  private buildSoloTable(input: CreateTaskInput): NodeTable {
    if (!input.employee) throw new EngineError('[engine] solo 模式必须提供 employee')
    return parseNodeTable({
      flow: `solo:${input.employee}`, max_retries: 3, terminal_fail: 'n-fail', delivery_node: 'n-done',
      nodes: [
        { id: 'n-exec', name: '执行', kind: 'action', emp: input.employee, prompt: '{{input}}', next: ['n-done'] },
        { id: 'n-done', name: '完成', kind: 'terminal', next: [] },
        { id: 'n-fail', name: '终止', kind: 'terminal', next: [] },
      ],
      gate_specs: {},
    })
  }

  private snapshotTable(taskId: string, meta: TaskMeta): NodeTable {
    const dir = taskDir(meta.workspace, taskId)
    const p = join(dir, 'table.snapshot.yml')
    if (!existsSync(p)) {
      throw new EngineError(`[engine] 表快照缺失（task ${taskId} 可能已归档）: ${p}`)
    }
    return parseNodeTable(yamlLoad(readFileSync(p, 'utf8')))
  }

  private loadedTable(taskId: string, meta: TaskMeta): LoadedTable {
    return loadNodeTable(this.snapshotTable(taskId, meta))
  }

  private toView(meta: TaskMeta, state: TaskState, taskId: string): TaskView {
    const view: TaskView = {
      task_id: taskId, flow: meta.flow, title: meta.title, workspace: meta.workspace,
      status: state.status, current_node: state.current_node,
      gate_iters: state.gate_iters, gate_calls: state.gate_calls,
      retries: state.retries, blocked_reason: state.blocked_reason,
    }
    try {
      const table = this.loadedTable(taskId, meta)
      const pos = position(table, state.current_node)
      if (pos) view.position = pos
    } catch {
      // 快照不可读（归档后）不阻塞状态视图——position 缺省
    }
    return view
  }

  private wrapR2(err: unknown, taskId: string): Error {
    return err instanceof Error
      ? new EngineError(`[engine] ${err.message}（task ${taskId}）`)
      : new EngineError(`[engine] advance 失败（task ${taskId}）`)
  }

  private wrapR3(err: unknown, taskId: string): Error {
    return err instanceof Error
      ? new EngineError(`[engine] ${err.message}（task ${taskId}）`)
      : new EngineError(`[engine] recordGate 失败（task ${taskId}）`)
  }
}

/** 节点 prompt 模板渲染：{{input}} / {{run.workspace}} / {{run.title}}（发起时注入数据源=meta） */
export function renderPrompt(template: string, meta: TaskMeta): string {
  return template
    .replaceAll('{{input}}', meta.input ?? '')
    .replaceAll('{{run.workspace}}', meta.workspace)
    .replaceAll('{{run.title}}', meta.title)
}

export { LedgerError }
