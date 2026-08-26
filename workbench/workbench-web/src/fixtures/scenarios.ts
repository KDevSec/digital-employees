/**
 * fixture 剧本生成器（L5 看板线 T2，设计 §6.2）：
 * 按协同编排设计 §7.3 schema 纯函数生成四剧本事件流（正常推进 / 闸位暂停 / reflow / 终止），
 * 序列即联调契约锚——测试 test/scenarios.test.ts 锁定其合法性（seq 连续/因果链/载荷完备），
 * 引擎线（feat/l3-engine）真实事件流跑同一断言即可对齐。
 *
 * 时间形态：ts 等差 3s（播放节奏属 MockEventSource，与生成解耦）；duration_s = 事件间隔数 × 3s。
 * 表快照随剧本选定（gate-pause 用 human_gate 变体表），scenarioTable 供 mock 服务下发。
 */
import type { EngineEvent } from '../api/engine-events'
import { demoFlowGatePauseTable, demoFlowTable, type TableSnapshot } from './demo-flow.table'

export type ScenarioName = 'happy-path' | 'gate-pause' | 'reflow' | 'abort'

export { demoFlowTable, demoFlowGatePauseTable, employees } from './demo-flow.table'

/** 剧本 → 表快照（gate-pause 换变体表，兼验证看板换表跟随） */
export const scenarioTable: Record<ScenarioName, TableSnapshot> = {
  'happy-path': demoFlowTable,
  'gate-pause': demoFlowGatePauseTable,
  reflow: demoFlowTable,
  abort: demoFlowTable,
}

export interface ScenarioOptions {
  taskId: string
  title: string
  workspace: string
  startTs?: string
}

/** 每事件时间步长（demo 节奏；MockEventSource 播放时可另行缩放） */
const STEP_S = 3

export function buildScenario(name: ScenarioName, opts: ScenarioOptions): EngineEvent[] {
  const startMs = opts.startTs ? Date.parse(opts.startTs) : Date.UTC(2026, 7, 27, 2, 0, 0)
  const events: EngineEvent[] = []
  let seq = 0
  let last = 0
  let dispatchNo = 0

  /** 组装通用壳 + 载荷并入队；返回本事件 seq（下一事件 parent 默认指它） */
  function emit(
    type: EngineEvent['type'],
    actor: string,
    payload: Record<string, unknown>,
    parent?: number,
  ): number {
    seq += 1
    events.push({
      seq,
      ts: new Date(startMs + seq * STEP_S * 1000).toISOString(),
      type,
      trace_id: opts.taskId,
      parent_seq: parent ?? last,
      actor,
      task_id: opts.taskId,
      ...payload,
    } as EngineEvent)
    last = seq
    return seq
  }

  const dispatchStart = (emp: string, node: string, parent?: number): number => {
    dispatchNo += 1
    return emit(
      'dispatch',
      'driver',
      { phase: 'start', emp, dispatch_id: `D-${dispatchNo}`, node },
      parent,
    )
  }

  const dispatchDone = (
    emp: string,
    node: string,
    parent: number,
    status = 'ok',
  ): number =>
    emit(
      'dispatch',
      emp,
      {
        phase: 'done',
        emp,
        dispatch_id: `D-${dispatchNo}`,
        node,
        status,
      },
      parent,
    )

  /** action 段：派发 → 干完 → （由调用方补 transition 出段） */
  const runAction = (emp: string, node: string, parent: number): number =>
    dispatchDone(emp, node, dispatchStart(emp, node, parent))

  /** AI 评审段：spawn 评审会话 → gate verdict → 会话收工（§5.2 模板时序） */
  const runGate = (
    gateId: string,
    coversNode: string,
    reviewer: string,
    verdict: 'PASS' | 'FAIL',
    iter: number,
    parent: number,
    issues?: string[],
  ): number => {
    const s = dispatchStart(reviewer, gateId, parent)
    const g = emit(
      'gate',
      reviewer,
      {
        gate: gateId,
        kind: 'review',
        node: coversNode,
        verdict,
        iter,
        reviewer,
        ...(issues ? { issues } : {}),
      },
      s,
    )
    return dispatchDone(reviewer, gateId, g)
  }

  const transition = (
    from: string | null,
    to: string,
    status: string,
    parent: number,
    extra?: Record<string, unknown>,
  ): number =>
    emit('transition', 'engine', { from, to, status, ...(extra ?? {}) }, parent)

  const created = (): number =>
    emit(
      'run.created',
      'human',
      {
        flow: 'demo-flow',
        title: opts.title,
        workspace: opts.workspace,
        display_name: '五阶段演示交付',
      },
      null,
    )

  const complete = (parent: number): void => {
    emit('run.completed', 'engine', { final_node: 'n-done', duration_s: seq * STEP_S }, parent)
  }

  /* ---------------- 四剧本 ---------------- */

  /** 需求→设计→开发→准出的既有链（happy 后半与 reflow/gate-pause 复用；fromNode 起 g-req-review 评审） */
  function afterRequirement(parent: number, opts2: { failCodeReview: boolean }): number {
    let p = runGate('g-req-review', 'n0-req', 'reviewer-expert', 'PASS', 1, parent)
    p = transition('g-req-review', 'n1-design', 'in_progress', p)
    p = runAction('sys-engineer', 'n1-design', p)
    p = transition('n1-design', 'g-design-review', 'in_progress', p)
    p = runGate('g-design-review', 'n1-design', 'reviewer-expert', 'PASS', 1, p)
    p = transition('g-design-review', 'g-sec-design', 'in_progress', p)
    p = runGate('g-sec-design', 'n1-design', 'sec-design', 'PASS', 1, p)
    p = transition('g-sec-design', 'n2-impl', 'in_progress', p)
    p = runAction('dev-engineer', 'n2-impl', p)
    p = transition('n2-impl', 'g-code-review', 'in_progress', p)
    if (opts2.failCodeReview) {
      // reflow 支线：首轮 FAIL → 回流重派 → 次轮 PASS（iter 递增）
      p = runGate('g-code-review', 'n2-impl', 'reviewer-expert', 'FAIL', 1, p, [
        '测试未覆盖边界条件 X',
      ])
      p = transition('g-code-review', 'n2-impl', 'in_progress', p, { reflow: true })
      p = runAction('dev-engineer', 'n2-impl', p)
      p = transition('n2-impl', 'g-code-review', 'in_progress', p)
      p = runGate('g-code-review', 'n2-impl', 'reviewer-expert', 'PASS', 2, p)
    } else {
      p = runGate('g-code-review', 'n2-impl', 'reviewer-expert', 'PASS', 1, p)
    }
    p = transition('g-code-review', 'g-sec-code', 'in_progress', p)
    p = runGate('g-sec-code', 'n2-impl', 'sec-code', 'PASS', 1, p)
    p = transition('g-sec-code', 'n3-sec', 'in_progress', p)
    p = runAction('sec-compliance', 'n3-sec', p)
    p = transition('n3-sec', 'n-done', 'completed', p)
    return p
  }

  if (name === 'happy-path') {
    let p = created()
    p = runAction('sec-compliance', 'n-adm', p)
    p = transition('n-adm', 'n0-req', 'in_progress', p)
    p = runAction('req-clarifier', 'n0-req', p)
    p = transition('n0-req', 'g-req-review', 'in_progress', p)
    p = afterRequirement(p, { failCodeReview: false })
    complete(p)
  } else if (name === 'gate-pause') {
    // 变体表：n0-req human_gate=true——进入即停靠（§5.3），人工 approve 进流水后续跑
    let p = created()
    p = runAction('sec-compliance', 'n-adm', p)
    p = transition('n-adm', 'n0-req', 'gate_paused', p)
    p = emit(
      'gate',
      'human',
      { gate: 'n0-req', kind: 'acceptance', node: 'n0-req', verdict: 'approve', iter: 1, reviewer: 'human' },
      p,
    )
    p = transition('n0-req', 'g-req-review', 'in_progress', p)
    p = afterRequirement(p, { failCodeReview: false })
    complete(p)
  } else if (name === 'reflow') {
    let p = created()
    p = runAction('sec-compliance', 'n-adm', p)
    p = transition('n-adm', 'n0-req', 'in_progress', p)
    p = runAction('req-clarifier', 'n0-req', p)
    p = transition('n0-req', 'g-req-review', 'in_progress', p)
    p = afterRequirement(p, { failCodeReview: true })
    complete(p)
  } else {
    // abort：推进至需求节点 spawn 失败 → run.aborted
    let p = created()
    p = runAction('sec-compliance', 'n-adm', p)
    p = transition('n-adm', 'n0-req', 'in_progress', p)
    const s = dispatchStart('req-clarifier', 'n0-req', p)
    const d = dispatchDone('req-clarifier', 'n0-req', s, 'error')
    emit(
      'run.aborted',
      'engine',
      { final_node: 'n0-req', reason: 'spawn 失败：底座 CLI 不可用（演示注入）' },
      d,
    )
  }

  return events
}
