/**
 * R2 节点机（1.0 pyieidev/ieidev_core/node_machine.py 语义逐条移植）。
 * - advance 三步：adjacency → guard → 不可变更新；纯函数零 IO，非法转移/守卫拒绝抛 NodeMachineError。
 * - bounded reflow：仅 reflow:true 计数（前进幂等豁免），溢出改投 terminal_fail（forced fail 正常返回），
 *   无 terminal_fail 配置则抛 retry overflow。
 * - gate_paused 停靠（human_gate）是引擎门面（T5）的职责，R2 只做纯转移；
 *   1.0 的 phase_history 在 2.0 对应 events.jsonl（R1/T5 落账），故 TaskState 不含 history 字段。
 */
import type { FlowNode, GateSpec, NodeKind, NodeTable } from '../schema/node-table'
import type { TaskState } from './state'

/** 节点机错误：非法转移/守卫拒绝/重试溢出——message 含定位 */
export class NodeMachineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NodeMachineError'
  }
}

/** 已校验表的归一化视图：nodeMap/adjacency 一次建好（校验前置在 T1 parseNodeTable） */
export interface LoadedTable extends NodeTable {
  nodeMap: Map<string, FlowNode>
  adjacency: Map<string, string[]>
}

export function loadNodeTable(table: NodeTable): LoadedTable {
  const nodeMap = new Map<string, FlowNode>()
  for (const n of table.nodes) nodeMap.set(n.id, n)
  return {
    ...table,
    nodeMap,
    adjacency: new Map(table.nodes.map((n) => [n.id, [...n.next]])),
  }
}

export interface AdvanceOptions {
  table: LoadedTable
  /** 守卫：返回非 null 字符串即拒绝（作为 reason 进入异常 message） */
  guard?: (s: TaskState, to: string) => string | null
  reflow?: boolean
  /** 转移原因——经引擎门面进 transition 事件载荷；state 无 history 字段故不影响返回值 */
  reason?: string | null
}

/**
 * 纯转移：返回新 state（新对象+新 retries Record，入参不被 mutate），或抛 NodeMachineError。
 * 不改 status（含 human_gate 停靠与 completed/aborted 归 T5）。
 */
export function advance(state: TaskState, to: string, opts: AdvanceOptions): TaskState {
  const { table, guard, reflow = false } = opts
  const current = state.current_node
  if (current === null) {
    throw new NodeMachineError('cannot advance: state has no current_node')
  }
  if (!table.adjacency.has(current)) {
    throw new NodeMachineError(`current_node '${current}' is not in the node-table`)
  }
  if (!table.adjacency.get(current)!.includes(to)) {
    throw new NodeMachineError(`illegal transition: '${current}' -> '${to}'`)
  }

  if (guard) {
    const gReason = guard(state, to)
    if (gReason !== null) {
      throw new NodeMachineError(`guard rejected '${current}' -> '${to}': ${gReason}`)
    }
  }

  // bounded reflow（1.0 原语义）：溢出当次仍先计数，再判是否改投/抛错
  const retries = { ...state.retries }
  let target = to
  if (reflow) {
    retries[to] = (retries[to] ?? 0) + 1
    if (retries[to] > table.max_retries) {
      if (table.terminal_fail === null) {
        throw new NodeMachineError(
          `retry overflow at '${to}' (> ${table.max_retries}) and no terminal_fail configured`,
        )
      }
      target = table.terminal_fail // forced fail：正常返回不抛
    }
  }

  return { ...state, current_node: target, retries }
}

export interface NextAction {
  to_node: string
  label: string
}

/** NextStepView 前六字段 + is_blocked/blocked_reason（门面 T5 在此之上组装完整视图） */
export interface NextActionsView {
  current_node: string | null
  node_kind: NodeKind | null
  node_name: string | null
  emp?: string
  prompt?: string
  next_actions: NextAction[]
  gate_spec?: GateSpec & { gate: string; current_iter: number; max_retries: number }
  is_blocked: boolean
  blocked_reason: string | null
}

/** 当前节点下一步动作面：terminal/blocked 空；gate 走 gate_spec 推导；action 走 adjacency */
export function getNextActions(state: TaskState, table: LoadedTable): NextActionsView {
  const current = state.current_node
  const isBlocked = state.status === 'blocked'
  const result: NextActionsView = {
    current_node: current,
    node_kind: null,
    node_name: null,
    next_actions: [],
    is_blocked: isBlocked,
    blocked_reason: state.blocked_reason,
  }

  const node = current !== null ? table.nodeMap.get(current) : undefined
  if (!node) return result // 未起步或未知节点：裸信息
  result.node_kind = node.kind
  result.node_name = node.name ?? node.id

  if (node.kind === 'terminal') return result
  if (isBlocked) return result

  if (node.kind === 'gate' && node.gate && Object.hasOwn(table.gate_specs, node.gate)) {
    const spec = table.gate_specs[node.gate]
    result.gate_spec = {
      ...spec,
      gate: node.gate,
      current_iter: state.gate_iters[node.gate] ?? 0,
      max_retries: table.max_retries,
    }
    if (spec.kind === 'decision') {
      for (const [key, target] of Object.entries(spec.branches ?? {})) {
        result.next_actions.push({ to_node: target, label: key })
      }
    } else {
      // review/acceptance：schema 层已保证 on_pass/on_reflow 在（parseNodeTable 前置校验）
      result.next_actions.push({ to_node: spec.on_pass!, label: 'PASS' })
      result.next_actions.push({ to_node: spec.on_reflow!, label: 'FAIL' })
    }
  } else {
    // action 节点：adjacency 逐目标（label=目标 name 缺省 id）；透传 emp/prompt，渲染归 T5
    if (node.emp !== undefined) result.emp = node.emp
    if (node.prompt !== undefined) result.prompt = node.prompt
    for (const nid of table.adjacency.get(current!) ?? []) {
      const target = table.nodeMap.get(nid)
      result.next_actions.push({ to_node: nid, label: target?.name ?? nid })
    }
  }
  return result
}

export interface Position {
  cleared: number
  total: number
  pct: number
}

/**
 * 里程碑位置（1.0 算法）：cleared=位于当前节点之前的 gate 数；total=gate 数+1（成功终点计 1）；
 * 成功 terminal=插入序中第一个非 terminal_fail 的 terminal → 100%；
 * 当前=terminal_fail 或不在表 → null。
 */
export function position(table: LoadedTable, node_id: string | null): Position | null {
  if (node_id === null || !table.nodeMap.has(node_id)) return null
  if (node_id === table.terminal_fail) return null

  const ordered = table.nodes // 插入序 = 作者序
  const idx = new Map(ordered.map((n, i) => [n.id, i]))
  const gateIdx = ordered.filter((n) => n.kind === 'gate').map((n) => idx.get(n.id)!)
  const successTerminal = ordered.find(
    (n) => n.kind === 'terminal' && n.id !== table.terminal_fail,
  )
  const total = gateIdx.length + 1

  if (successTerminal !== undefined && node_id === successTerminal.id) {
    return { cleared: total, total, pct: 100 }
  }
  const cur = idx.get(node_id)!
  const cleared = gateIdx.filter((g) => g < cur).length
  return { cleared, total, pct: total > 0 ? Math.round((100 * cleared) / total) : 0 }
}
