import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { parseNodeTable } from '../src/schema/node-table'
import { advance, loadNodeTable } from '../src/r2/node-machine'
import type { LoadedTable } from '../src/r2/node-machine'
import type { TaskState } from '../src/r2/state'
import { GateError, makeGateResult, recordGate } from '../src/r3/gate'
import type { GateResult } from '../src/r3/gate'

/** 契约真源真表：assets/flows/demo-flow.node-table.yml（同 T1/T2 测试模式） */
const tablePath = fileURLToPath(new URL('../assets/flows/demo-flow.node-table.yml', import.meta.url))
const loaded = loadNodeTable(parseNodeTable(yamlLoad(readFileSync(tablePath, 'utf8'))))

const initState = (current_node: string | null, extra?: Partial<TaskState>): TaskState => ({
  status: 'in_progress',
  current_node,
  gate_iters: {},
  gate_calls: 0,
  retries: {},
  blocked_reason: null,
  ...extra,
})

/** 快捷构造合法 GateResult（makeGateResult 归一后返回） */
const gateResult = (
  p: { gate: string; kind: GateResult['kind']; verdict: string } & Partial<GateResult>,
): GateResult => makeGateResult({ node: null, request_id: 'rq-1', by: 'tester', ...p })

/** 代码内构造 max_retries=3 小表：a --前进--> g(gate) --on_reflow--> a 循环 + on_pass 终点 b */
const failTable = (): LoadedTable =>
  loadNodeTable(
    parseNodeTable({
      flow: 'r3-fail-t',
      max_retries: 3,
      nodes: [
        { id: 'a', kind: 'action', next: ['g'] },
        { id: 'g', kind: 'gate', gate: 'g-test', next: ['b', 'a'] },
        { id: 'b', kind: 'terminal', next: [] },
      ],
      gate_specs: { 'g-test': { kind: 'review' as const, reviewer: 'r', on_pass: 'b', on_reflow: 'a' } },
    }),
  )

/** g 位记一次 FAIL（→ on_reflow a），再前进回 g（模拟返工后重回闸口） */
const failOnceAndBack = (t: LoadedTable, s: TaskState): TaskState =>
  advance(
    recordGate(s, gateResult({ gate: 'g-test', kind: 'review', verdict: 'FAIL' }), { table: t }),
    'g',
    { table: t },
  )

/** 代码内构造 decision 表：d0(gate) --go--> n-go / --rework--> n-rw */
const decisionTable = (): LoadedTable =>
  loadNodeTable(
    parseNodeTable({
      flow: 'r3-dec-t',
      nodes: [
        { id: 'd0', kind: 'gate', gate: 'g-dec', next: ['n-go', 'n-rw'] },
        { id: 'n-go', kind: 'terminal', next: [] },
        { id: 'n-rw', kind: 'terminal', next: [] },
      ],
      gate_specs: { 'g-dec': { kind: 'decision' as const, reviewer: 'r', branches: { go: 'n-go', rework: 'n-rw' } } },
    }),
  )

/** 代码内构造 acceptance 表：fix --前进--> g-acc(gate) --on_pass--> ship / --on_reflow--> fix */
const acceptanceTable = (): LoadedTable =>
  loadNodeTable(
    parseNodeTable({
      flow: 'r3-acc-t',
      nodes: [
        { id: 'fix', kind: 'action', next: ['g-acc'] },
        { id: 'g-acc', kind: 'gate', gate: 'g-acc', next: ['ship', 'fix'] },
        { id: 'ship', kind: 'terminal', next: [] },
      ],
      gate_specs: { 'g-acc': { kind: 'acceptance' as const, reviewer: 'r', on_pass: 'ship', on_reflow: 'fix' } },
    }),
  )

describe('R3 makeGateResult（结构校验 + 缺省归一，1.0 make_gate_result）', () => {
  it('review verdict 带空格 "PASS " → GateError（严格枚举，不 trim）', () => {
    expect(() =>
      gateResult({ gate: 'g1', kind: 'review', verdict: 'PASS ' }),
    ).toThrow(GateError)
    expect(() => gateResult({ gate: 'g1', kind: 'review', verdict: 'PASS ' })).toThrow(
      'review verdict must be PASS/FAIL',
    )
  })

  it('acceptance 非法 verdict 同报；decision verdict 不在此校验（branches 校验在 recordGate 运行时）', () => {
    expect(() => gateResult({ gate: 'g1', kind: 'acceptance', verdict: 'maybe' })).toThrow(GateError)
    expect(() => gateResult({ gate: 'g1', kind: 'decision', verdict: 'whatever' })).not.toThrow()
  })

  it('空 gate / 空 request_id → GateError', () => {
    expect(() => gateResult({ gate: '', kind: 'review', verdict: 'PASS' })).toThrow(GateError)
    expect(() => gateResult({ gate: '', kind: 'review', verdict: 'PASS' })).toThrow('gate id')
    expect(() =>
      makeGateResult({ gate: 'g1', kind: 'review', node: null, verdict: 'PASS', request_id: '', by: 'x' }),
    ).toThrow(GateError)
    expect(() =>
      makeGateResult({ gate: 'g1', kind: 'review', node: null, verdict: 'PASS', request_id: '', by: 'x' }),
    ).toThrow('request_id')
  })

  it('缺省归一：iter=1、issues=[]、revisions=[]；余字段透传', () => {
    const gr = makeGateResult({
      gate: 'g1',
      kind: 'review',
      node: 'n-a',
      verdict: 'FAIL',
      request_id: 'rq-9',
      by: 'reviewer-expert',
    })
    expect(gr.iter).toBe(1)
    expect(gr.issues).toEqual([])
    expect(gr.revisions).toEqual([])
    expect(gr.ts).toEqual(expect.any(String))
    expect(gr.gate).toBe('g1')
    expect(gr.node).toBe('n-a')
    expect(gr.verdict).toBe('FAIL')
    expect(gr.request_id).toBe('rq-9')
    expect(gr.by).toBe('reviewer-expert')
  })

  it('显式值不被覆盖（iter/issues/revisions/ts 透传）', () => {
    const gr = makeGateResult({
      gate: 'g1',
      kind: 'review',
      node: null,
      verdict: 'PASS',
      request_id: 'rq-1',
      by: 'x',
      iter: 3,
      issues: ['i1'],
      revisions: ['r1'],
      ts: '2026-08-26T00:00:00Z',
    })
    expect(gr).toMatchObject({ iter: 3, issues: ['i1'], revisions: ['r1'], ts: '2026-08-26T00:00:00Z' })
  })
})

describe('R3 recordGate：review PASS（demo 表）', () => {
  it('PASS → advance(on_pass)+gate_iters 清零+gate_calls=1', () => {
    const s = recordGate(
      initState('g-req-review', { gate_iters: { 'g-req-review': 2 } }),
      gateResult({ gate: 'g-req-review', kind: 'review', verdict: 'PASS' }),
      { table: loaded },
    )
    expect(s.current_node).toBe('n1-design') // on_pass
    expect(s.gate_iters).toEqual({ 'g-req-review': 0 }) // 清零（造 2 再 PASS 验证）
    expect(s.gate_calls).toBe(1)
    expect(s.status).toBe('in_progress')
    expect(s.retries).toEqual({}) // R3 恒 reflow:false，不碰 R2 机械计数
  })
})

describe('R3 recordGate：review FAIL 计数与 blocked（max_retries=3 小表）', () => {
  it('FAIL 第 1/2 次：advance(on_reflow)、gate_iters 递增、retries 空对象（两套溢出语义关键断言）', () => {
    const t = failTable()
    const s1 = recordGate(initState('g'), gateResult({ gate: 'g-test', kind: 'review', verdict: 'FAIL' }), {
      table: t,
    })
    expect(s1.current_node).toBe('a') // on_reflow
    expect(s1.gate_iters).toEqual({ 'g-test': 1 })
    expect(s1.gate_calls).toBe(1)
    expect(s1.retries).toEqual({}) // R3 路径不碰 R2 机械 reflow 计数

    // 返工后前进回 g（reflow:false 不计数），再记 FAIL#2
    const s2 = recordGate(
      advance(s1, 'g', { table: t }),
      gateResult({ gate: 'g-test', kind: 'review', verdict: 'FAIL' }),
      { table: t },
    )
    expect(s2.current_node).toBe('a')
    expect(s2.gate_iters).toEqual({ 'g-test': 2 })
    expect(s2.gate_calls).toBe(2)
    expect(s2.retries).toEqual({})
  })

  it('FAIL 第 3 次（=cap）：blocked + escalate 文案，current_node 原地不动（gate 节点位），不 force-accept', () => {
    const t = failTable()
    let s = initState('g')
    s = failOnceAndBack(t, s) // FAIL#1
    s = failOnceAndBack(t, s) // FAIL#2
    const s3 = recordGate(s, gateResult({ gate: 'g-test', kind: 'review', verdict: 'FAIL' }), { table: t })
    expect(s3.status).toBe('blocked')
    expect(s3.blocked_reason).toBe('g-test failed 3x (>= 3); escalate to human') // 1.0 逐字
    expect(s3.blocked_reason).toContain('escalate to human')
    expect(s3.blocked_reason).toContain('3x')
    expect(s3.current_node).toBe('g') // 原地 gate 节点位，未 advance
    expect(s3.gate_iters).toEqual({ 'g-test': 3 })
    expect(s3.gate_calls).toBe(3)
    expect(s3.current_node).not.toBe('b') // 无 force-accept（1.0 铁律）
  })

  it('非法 verdict（绕过 makeGateResult 手搓）→ GateError', () => {
    const bad = { ...gateResult({ gate: 'g-test', kind: 'review', verdict: 'PASS' }), verdict: 'MAYBE' }
    expect(() => recordGate(initState('g'), bad, { table: failTable() })).toThrow(GateError)
    expect(() => recordGate(initState('g'), bad, { table: failTable() })).toThrow(
      'review verdict must be PASS/FAIL',
    )
  })
})

describe('R3 recordGate：decision（branches 分派）', () => {
  it("verdict='go' → advance(n-go)；gate_calls 照增、gate_iters 原样透传", () => {
    const s = recordGate(
      initState('d0', { gate_iters: { 'g-dec': 2 }, gate_calls: 4 }),
      gateResult({ gate: 'g-dec', kind: 'decision', verdict: 'go' }),
      { table: decisionTable() },
    )
    expect(s.current_node).toBe('n-go')
    expect(s.gate_iters).toEqual({ 'g-dec': 2 }) // decision 不动 gate_iters（1.0 透传）
    expect(s.gate_calls).toBe(5)
  })

  it("verdict='rework' → advance(n-rw)", () => {
    const s = recordGate(
      initState('d0'),
      gateResult({ gate: 'g-dec', kind: 'decision', verdict: 'rework' }),
      { table: decisionTable() },
    )
    expect(s.current_node).toBe('n-rw')
  })

  it("verdict='unknown' → GateError 且 message 列出 go/rework；'toString'（原型链）同报", () => {
    const t = decisionTable()
    expect(() =>
      recordGate(initState('d0'), gateResult({ gate: 'g-dec', kind: 'decision', verdict: 'unknown' }), {
        table: t,
      }),
    ).toThrow(GateError)
    expect(() =>
      recordGate(initState('d0'), gateResult({ gate: 'g-dec', kind: 'decision', verdict: 'unknown' }), {
        table: t,
      }),
    ).toThrow(/go.*rework/)
    expect(() =>
      recordGate(initState('d0'), gateResult({ gate: 'g-dec', kind: 'decision', verdict: 'toString' }), {
        table: t,
      }),
    ).toThrow(GateError)
  })
})

describe('R3 recordGate：acceptance（同 review 语义复测·PASS 路径）', () => {
  it('PASS → advance(on_pass)+清零；kind 分派走 acceptance 分支', () => {
    const s = recordGate(
      initState('g-acc', { gate_iters: { 'g-acc': 1 } }),
      gateResult({ gate: 'g-acc', kind: 'acceptance', verdict: 'PASS' }),
      { table: acceptanceTable() },
    )
    expect(s.current_node).toBe('ship')
    expect(s.gate_iters).toEqual({ 'g-acc': 0 })
    expect(s.gate_calls).toBe(1)
  })
})

describe('R3 recordGate：未知 gate 与纯函数性', () => {
  it("gate 不在 specs → GateError（no gate spec for gate 'X'）；'toString'（原型链）同报", () => {
    expect(() =>
      recordGate(initState('g-req-review'), gateResult({ gate: 'g-unknown', kind: 'review', verdict: 'PASS' }), {
        table: loaded,
      }),
    ).toThrow(GateError)
    expect(() =>
      recordGate(initState('g-req-review'), gateResult({ gate: 'g-unknown', kind: 'review', verdict: 'PASS' }), {
        table: loaded,
      }),
    ).toThrow("no gate spec for gate 'g-unknown'")
    expect(() =>
      recordGate(initState('g-req-review'), gateResult({ gate: 'toString', kind: 'review', verdict: 'PASS' }), {
        table: loaded,
      }),
    ).toThrow(GateError)
  })

  it('recordGate 后入参 state 深比较不变（PASS 与 blocked 两路径，structuredClone 快照）', () => {
    // PASS 路径（demo 表，嵌套计数预置）
    const sp = initState('g-req-review', { gate_iters: { 'g-req-review': 2 }, retries: { 'n0-req': 1 } })
    const snapP = structuredClone(sp)
    recordGate(sp, gateResult({ gate: 'g-req-review', kind: 'review', verdict: 'PASS' }), { table: loaded })
    expect(sp).toEqual(snapP)

    // blocked 路径（FAIL 达 cap：预置 iters=2，一次 FAIL → 3 >= cap 3）
    const t = failTable()
    const sb = initState('g', { gate_iters: { 'g-test': 2, other: 7 } })
    const snapB = structuredClone(sb)
    const out = recordGate(sb, gateResult({ gate: 'g-test', kind: 'review', verdict: 'FAIL' }), { table: t })
    expect(out.status).toBe('blocked')
    expect(out.gate_iters).toEqual({ 'g-test': 3, other: 7 }) // 其余 gate 计数透传不动
    expect(sb).toEqual(snapB) // 入参原对象未被 mutate
  })
})
