/**
 * R3 三类 gate（1.0 pyieidev/ieidev_core/gate.py 语义逐条移植）。
 * - makeGateResult：结构校验+缺省归一（decision verdict 不在此校验，对 branches 的校验在
 *   recordGate 运行时——branches 是表内 spec 的属性，构造 GateResult 时不可见）。
 * - recordGate：纯函数。gate_calls 流级总数 + review/acceptance 三分支
 *   （PASS 清零→on_pass / FAIL 计数未达 cap→on_reflow / 达 cap→blocked 不推进不 force-accept）
 *   + decision 按 spec.branches 分派（gate_iters 原样透传）。
 * - R3 调 advance 恒 reflow:false——评审上限由 gate_iters 自持（cap=table.max_retries），
 *   与 R2 机械 reflow 溢出（retries→terminal_fail）是两套语义，1.0 原样。
 * - gate_specs/branches 成员判定一律 Object.hasOwn：原型链属性（'toString' 等）不得被当作 spec。
 *   1.0 用 dict.get 天然自持；TS 裸 `in`/索引访问会命中 Object.prototype，故显式收口。
 * 事件流（gate 事件）与 request_id 落账归 T5 门面，本层只做状态转移。
 */
import { advance } from '../r2/node-machine'
import type { LoadedTable } from '../r2/node-machine'
import type { TaskState } from '../r2/state'

/** GateResult 结构/verdict 枚举/未知 gate/decision 分派失败——message 含定位 */
export class GateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GateError'
  }
}

/** 流侧回报的结构化判定（1.0 GateResult dict；kind 分派以表内 spec 为准，此处 kind 仅作构造期校验依据） */
export interface GateResult {
  gate: string
  kind: 'review' | 'acceptance' | 'decision'
  node: string | null
  verdict: string
  request_id: string
  by: string
  iter?: number
  issues?: string[]
  revisions?: string[]
  ts?: string
}

const GATE_VERDICTS = new Set(['PASS', 'FAIL']) // review/acceptance；decision 用 branch key

function nowIso(): string {
  return new Date().toISOString()
}

/** 构造+校验 GateResult：gate/request_id 非空；review/acceptance verdict ∈ {PASS,FAIL}；iter 缺省 1；issues/revisions 缺省 [] */
export function makeGateResult(g: GateResult): GateResult {
  if (!g.gate) throw new GateError('GateResult requires a non-empty gate id')
  if (!g.request_id) throw new GateError('GateResult requires a non-empty request_id')
  if (
    (g.kind === 'review' || g.kind === 'acceptance') &&
    !GATE_VERDICTS.has(g.verdict)
  ) {
    throw new GateError(`${g.kind} verdict must be PASS/FAIL, got '${g.verdict}'`)
  }
  return {
    ...g,
    iter: g.iter ?? 1,
    issues: [...(g.issues ?? [])],
    revisions: [...(g.revisions ?? [])],
    ts: g.ts ?? nowIso(),
  }
}

export interface RecordGateOptions {
  table: LoadedTable
}

/**
 * 记录一条 GateResult 并施加其转移（1.0 record_gate）。纯函数：返回新 state，入参不被 mutate。
 * gate_calls 恒先自增（流级总数）；review/acceptance 的 cap=table.max_retries；
 * FAIL 达 cap 返回 blocked 现场（不 advance、不 force-accept）；decision 不动 gate_iters。
 */
export function recordGate(state: TaskState, gr: GateResult, opts: RecordGateOptions): TaskState {
  const { table } = opts
  const gid = gr.gate
  if (!Object.hasOwn(table.gate_specs, gid)) {
    throw new GateError(`no gate spec for gate '${gid}'`)
  }
  const spec = table.gate_specs[gid]
  const cap = table.max_retries

  const next: TaskState = { ...state, gate_calls: state.gate_calls + 1 }
  const gate_iters = { ...state.gate_iters }
  const verdict = gr.verdict

  if (spec.kind === 'review' || spec.kind === 'acceptance') {
    if (verdict === 'PASS') {
      gate_iters[gid] = 0 // 清零（此前累计的失败次数随通过作废）
      return advance({ ...next, gate_iters }, spec.on_pass!, {
        table,
        reflow: false,
        reason: `${gid} PASS`,
      })
    }
    if (verdict === 'FAIL') {
      gate_iters[gid] = (gate_iters[gid] ?? 0) + 1
      if (gate_iters[gid] >= cap) {
        return {
          ...next,
          gate_iters,
          status: 'blocked',
          blocked_reason: `${gid} failed ${gate_iters[gid]}x (>= ${cap}); escalate to human`,
        }
      }
      return advance({ ...next, gate_iters }, spec.on_reflow!, {
        table,
        reflow: false, // R3 自持 gate_iters 上限，不走 R2 机械 reflow 计数
        reason: `${gid} FAIL reflow#${gate_iters[gid]}`,
      })
    }
    throw new GateError(`${spec.kind} verdict must be PASS/FAIL, got '${verdict}'`)
  }

  if (spec.kind === 'decision') {
    const branches = spec.branches ?? {}
    if (!Object.hasOwn(branches, verdict)) {
      throw new GateError(
        `decision '${gid}' verdict '${verdict}' not in branches [${Object.keys(branches)
          .sort()
          .join(', ')}]`,
      )
    }
    return advance({ ...next, gate_iters }, branches[verdict], {
      table,
      reflow: false,
      reason: `${gid} decision=${verdict}`,
    })
  }

  throw new GateError(`unknown gate kind '${spec.kind}' for gate '${gid}'`)
}
