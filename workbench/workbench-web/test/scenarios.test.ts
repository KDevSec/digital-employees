import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import {
  buildScenario,
  demoFlowGatePauseTable,
  demoFlowTable,
  employees,
  type ScenarioName,
} from '../src/fixtures/scenarios'

/**
 * fixture 剧本自检（L5 看板线 T2，设计 §6.2）——事件契约的消费者侧锚：
 * 四剧本按协同编排设计 §7.3 schema 生成（seq 连续 / trace_id 贯穿 / parent_seq 因果链 /
 * 六类载荷完备）。引擎线（feat/l3-engine）实现同一契约后，真实事件流跑同一组断言即可对齐。
 * 本测试锁定的是「剧本合法性」本身——先红后绿的契约先行。
 */

const OPTS = { taskId: 'R-100', title: '支付网关对接联调', workspace: 'D:/demo/r-x' }

/** 全剧本通用的结构自检（§7.3：append-only 行号 + 因果链 + trace 贯穿） */
function assertInvariants(events: EngineEvent[], expectTerminal: 'run.completed' | 'run.aborted') {
  // seq 1-based 连续无洞
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
  // trace_id 全 = taskId；task_id 全在场
  for (const e of events) {
    expect(e.trace_id).toBe(OPTS.taskId)
    expect(e.task_id).toBe(OPTS.taskId)
  }
  // parent_seq 为 null 或 < 自身 seq（因果链只指向过去）
  for (const e of events) {
    if (e.parent_seq !== null) expect(e.parent_seq).toBeLessThan(e.seq)
  }
  // ts 严格递增（ISO 字符串等差生成）
  for (let i = 1; i < events.length; i++) {
    expect(new Date(events[i].ts).getTime()).toBeGreaterThan(new Date(events[i - 1].ts).getTime())
  }
  // 首事件 run.created，末事件 = 预期终态
  expect(events[0].type).toBe('run.created')
  expect(events[events.length - 1].type).toBe(expectTerminal)
}

/** dispatch_id 严格 start/done 一对一配对 */
function assertDispatchPairs(events: EngineEvent[]) {
  const starts = events.filter((e) => e.type === 'dispatch' && e.phase === 'start')
  const dones = events.filter((e) => e.type === 'dispatch' && e.phase === 'done')
  expect(starts.map((e) => (e as { dispatch_id: string }).dispatch_id)).toEqual(
    dones.map((e) => (e as { dispatch_id: string }).dispatch_id),
  )
}

describe('demo-flow 表快照（§6.1 十二节点形态）', () => {
  it('十二节点五阶段：非 terminal 节点 stage 齐、n-done/n-fail 为 terminal', () => {
    expect(demoFlowTable.nodes).toHaveLength(12)
    const nonTerminal = demoFlowTable.nodes.filter((n) => n.kind !== 'terminal')
    const stages = [...new Set(nonTerminal.map((n) => n.stage))]
    expect(stages).toEqual(['准入', '需求核验', '设计核验', '开发实现', '准出'])
    const terminals = demoFlowTable.nodes.filter((n) => n.kind === 'terminal')
    expect(terminals.map((n) => n.id).sort()).toEqual(['n-done', 'n-fail'])
    // terminal 无 stage（YAML 原样——派生层归「未分组」的依据）
    expect(terminals.every((n) => n.stage === undefined)).toBe(true)
  })

  it('demo 表无人工闸；变体表 n0-req human_gate=true（换表跟随验证锚）', () => {
    expect(demoFlowTable.nodes.find((n) => n.id === 'n0-req')?.human_gate).toBeUndefined()
    expect(demoFlowGatePauseTable.nodes.find((n) => n.id === 'n0-req')?.human_gate).toBe(true)
    // 其余节点与 demo 表一致
    expect(demoFlowGatePauseTable.nodes).toHaveLength(12)
  })

  it('gate_specs 五闸与节点 kind=gate 对齐；reviewer 为员工 id', () => {
    expect(Object.keys(demoFlowTable.gate_specs)).toHaveLength(5)
    const gateNodes = demoFlowTable.nodes.filter((n) => n.kind === 'gate')
    expect(gateNodes.map((n) => n.id)).toEqual(Object.keys(demoFlowTable.gate_specs))
    for (const spec of Object.values(demoFlowTable.gate_specs)) {
      expect(employees[spec.reviewer]).toBeDefined()
    }
  })

  it('七员工映射齐（D-044 花名册）', () => {
    expect(Object.keys(employees)).toHaveLength(7)
    expect(employees['sec-compliance']).toBe('安全合规审核员')
  })
})

describe.each(['happy-path', 'gate-pause', 'reflow', 'abort'] as const)('剧本 %s 结构自检', (name: ScenarioName) => {
  const events = buildScenario(name, OPTS)

  it('seq/trace/parent_seq/ts 不变量 + 首尾事件', () => {
    assertInvariants(events, name === 'abort' ? 'run.aborted' : 'run.completed')
  })

  it('run.created 载荷：flow/title/workspace/display_name', () => {
    const first = events[0] as Extract<EngineEvent, { type: 'run.created' }>
    expect(first.flow).toBe('demo-flow')
    expect(first.title).toBe(OPTS.title)
    expect(first.workspace).toBe(OPTS.workspace)
    expect(first.display_name).toBe('五阶段演示交付')
  })

  it('dispatch start/done 严格配对', () => {
    assertDispatchPairs(events)
  })
})

describe('剧本差异语义', () => {
  it('happy-path：全链推进到 n-done；5 gate 全 PASS；transition 链首尾相接', () => {
    const events = buildScenario('happy-path', OPTS)
    const gates = events.filter((e) => e.type === 'gate')
    expect(gates).toHaveLength(5)
    expect(gates.every((g) => (g as { verdict: string }).verdict === 'PASS')).toBe(true)
    // dispatch done 全 done（引擎取值集 done|blocked——歧义 F 落定，routes/engine.ts zod enum 同源）
    const dones = events.filter((e) => e.type === 'dispatch' && (e as { phase: string }).phase === 'done')
    expect(dones.every((d) => (d as { status?: string }).status === 'done')).toBe(true)
    // transition 链首尾相接：前一个 to = 后一个 from
    const transitions = events.filter((e) => e.type === 'transition') as Array<{
      from: string | null
      to: string
    }>
    expect(transitions[0].from).toBe('n-adm')
    expect(transitions[transitions.length - 1].to).toBe('n-done')
    for (let i = 1; i < transitions.length; i++) {
      expect(transitions[i].from).toBe(transitions[i - 1].to)
    }
    // duration_s 与事件节奏自洽（每事件 3s 等差）
    const last = events[events.length - 1] as Extract<EngineEvent, { type: 'run.completed' }>
    expect(last.duration_s).toBe((events.length - 1) * 3)
  })

  it('gate-pause：进入 human_gate 节点停靠（status 快照）→ 人工 approve 进流水 → 续跑完成', () => {
    const events = buildScenario('gate-pause', OPTS)
    const paused = events.find(
      (e) => e.type === 'transition' && (e as { status: string }).status === 'gate_paused',
    ) as { to: string } | undefined
    expect(paused?.to).toBe('n0-req')
    const humanGate = events.find(
      (e) => e.type === 'gate' && (e as { actor: string }).actor === 'human',
    ) as { verdict: string; gate: string } | undefined
    expect(humanGate?.verdict).toBe('approve')
    expect(humanGate?.gate).toBe('n0-req')
    // 放行后存在 in_progress transition 续跑（from=停靠节点）
    const resume = events.find(
      (e) =>
        e.type === 'transition' &&
        (e as { from: string | null }).from === 'n0-req' &&
        (e as { status: string }).status === 'in_progress',
    )
    expect(resume).toBeDefined()
  })

  it('reflow：g-code-review FAIL(iter:1) → reflow 回 n2-impl → 重派 → PASS(iter:2)', () => {
    const events = buildScenario('reflow', OPTS)
    const reflowT = events.find(
      (e) => e.type === 'transition' && (e as { reflow?: boolean }).reflow === true,
    ) as { from: string; to: string } | undefined
    expect(reflowT?.from).toBe('g-code-review')
    expect(reflowT?.to).toBe('n2-impl')
    const codeGates = events.filter(
      (e) => e.type === 'gate' && (e as { gate: string }).gate === 'g-code-review',
    ) as Array<{ verdict: string; iter: number }>
    expect(codeGates.map((g) => `${g.verdict}:${g.iter}`)).toEqual(['FAIL:1', 'PASS:2'])
    // n2-impl 被派两次（重派）
    const implStarts = events.filter(
      (e) =>
        e.type === 'dispatch' &&
        (e as { phase: string }).phase === 'start' &&
        (e as { node?: string }).node === 'n2-impl',
    )
    expect(implStarts).toHaveLength(2)
  })

  it('abort：dispatch done status=blocked（引擎取值集，歧义 F）→ run.aborted 带原因', () => {
    const events = buildScenario('abort', OPTS)
    const errDone = events.find(
      (e) => e.type === 'dispatch' && (e as { status?: string }).status === 'blocked',
    )
    expect(errDone).toBeDefined()
    const last = events[events.length - 1] as Extract<EngineEvent, { type: 'run.aborted' }>
    expect(last.reason.length).toBeGreaterThan(0)
    expect(last.final_node).toBe('n0-req')
  })
})
