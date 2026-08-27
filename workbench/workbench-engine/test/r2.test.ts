import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { parseNodeTable } from '../src/schema/node-table'
import {
  advance,
  getNextActions,
  loadNodeTable,
  NodeMachineError,
  position,
} from '../src/r2/node-machine'
import type { LoadedTable } from '../src/r2/node-machine'
import type { TaskState } from '../src/r2/state'

/** 契约真源真表：assets/flows/demo-flow.node-table.yml（同 T1 测试模式） */
const tablePath = fileURLToPath(new URL('../assets/flows/demo-flow.node-table.yml', import.meta.url))
const loaded = loadNodeTable(parseNodeTable(yamlLoad(readFileSync(tablePath, 'utf8'))))

/** demo 表全链合法推进序（作者序） */
const CHAIN = [
  'n-adm', 'n0-req', 'g-req-review', 'n1-design', 'g-design-review', 'g-sec-design',
  'n2-impl', 'g-code-review', 'g-sec-code', 'n3-sec', 'n-done',
]

const initState = (current_node: string | null): TaskState => ({
  status: 'in_progress',
  current_node,
  gate_iters: {},
  gate_calls: 0,
  retries: {},
  blocked_reason: null,
})

/** 代码内构造 max_retries=2 小表：g --reflow--> a 循环 + 成功终点 b（withFail=true 加失败终点 t-fail） */
const reflowTable = (withFail: boolean): LoadedTable =>
  loadNodeTable(
    parseNodeTable({
      flow: 'reflow-t',
      max_retries: 2,
      ...(withFail ? { terminal_fail: 't-fail' } : {}),
      nodes: [
        { id: 'a', kind: 'action', next: ['g'] },
        { id: 'g', kind: 'gate', gate: 'g', next: ['b', 'a'] },
        { id: 'b', kind: 'terminal', next: [] },
        ...(withFail ? [{ id: 't-fail', kind: 'terminal' as const, next: [] }] : []),
      ],
      gate_specs: { g: { kind: 'review' as const, reviewer: 'r', on_pass: 'b', on_reflow: 'a' } },
    }),
  )

/** 从 g 出发做 n 次 reflow（g --reflow--> a；a 仍在表内则前进回 g）。溢出时返回 forced/抛错现场 state */
const reflowNTimes = (table: LoadedTable, n: number): TaskState => {
  let s = initState('g')
  for (let i = 0; i < n; i++) {
    s = advance(s, 'a', { table, reflow: true })
    if (s.current_node === 'a') s = advance(s, 'g', { table })
  }
  return s
}

describe('R2 loadNodeTable（归一化视图）', () => {
  it('nodeMap/adjacency 就位（校验前置在 T1 parseNodeTable）', () => {
    expect(loaded.nodeMap.size).toBe(12)
    expect(loaded.adjacency.get('n-adm')).toEqual(['n0-req'])
    expect(loaded.flow).toBe('demo-flow')
  })
})

describe('R2 advance：adjacency → guard → 不可变更新（1.0 三步语义）', () => {
  it('推进链全通：每步 current_node 断言 + 入参 state 不被 mutate', () => {
    let state = initState(CHAIN[0])
    for (let i = 1; i < CHAIN.length; i++) {
      const prev = state
      const snapshot = structuredClone(prev)
      state = advance(prev, CHAIN[i], { table: loaded })
      expect(state.current_node).toBe(CHAIN[i])
      expect(state).not.toBe(prev) // 不可变更新：新对象
      expect(prev).toEqual(snapshot) // 入参原对象未被 mutate
    }
  })

  it('跳步 n-adm → n1-design 抛 illegal transition（message 含定位）', () => {
    expect(() => advance(initState('n-adm'), 'n1-design', { table: loaded })).toThrow(
      NodeMachineError,
    )
    expect(() => advance(initState('n-adm'), 'n1-design', { table: loaded })).toThrow(
      "illegal transition: 'n-adm' -> 'n1-design'",
    )
  })

  it('current_node 为 null 抛错', () => {
    expect(() => advance(initState(null), 'n-adm', { table: loaded })).toThrow(NodeMachineError)
    expect(() => advance(initState(null), 'n-adm', { table: loaded })).toThrow('no current_node')
  })

  it('current_node 不在表抛错', () => {
    expect(() => advance(initState('nX'), 'n-adm', { table: loaded })).toThrow(
      "current_node 'nX' is not in the node-table",
    )
  })

  it('guard 拒绝：抛 guard rejected 含 reason，state 不变', () => {
    const prev = initState('n-adm')
    const snapshot = structuredClone(prev)
    const guard = () => '需求文档缺失'
    expect(() => advance(prev, 'n0-req', { table: loaded, guard })).toThrow(NodeMachineError)
    expect(() => advance(prev, 'n0-req', { table: loaded, guard })).toThrow(
      "guard rejected 'n-adm' -> 'n0-req': 需求文档缺失",
    )
    expect(prev).toEqual(snapshot) // 引用同一对象，字段未被改动
  })
})

describe('R2 bounded reflow（仅 reflow 计数，前进永不计数——幂等豁免）', () => {
  it('demo 表：reflow:true 计数 retries；随后前进 reflow:false 计数不变', () => {
    const s1 = advance(initState('g-code-review'), 'n2-impl', { table: loaded, reflow: true })
    expect(s1.current_node).toBe('n2-impl')
    expect(s1.retries['n2-impl']).toBe(1)
    const s2 = advance(s1, 'g-code-review', { table: loaded }) // 前进：不计数
    expect(s2.current_node).toBe('g-code-review')
    expect(s2.retries).toEqual({ 'n2-impl': 1 })
  })

  it('max_retries=2 + terminal_fail：第 3 次 reflow forced 改投 t-fail（正常返回不抛）', () => {
    const table = reflowTable(true)
    const s = reflowNTimes(table, 3)
    expect(s.current_node).toBe('t-fail')
    expect(s.retries['a']).toBe(3) // 溢出当次仍先计数（1.0 原语义）
  })

  it('同表去掉 terminal_fail：第 3 次 reflow 抛 retry overflow', () => {
    const table = reflowTable(false)
    expect(() => reflowNTimes(table, 3)).toThrow(NodeMachineError)
    expect(() => reflowNTimes(table, 3)).toThrow('retry overflow')
  })

  it('max_retries=2 内的第 2 次 reflow 正常回流', () => {
    const s = reflowNTimes(reflowTable(true), 2)
    expect(s.current_node).toBe('g')
    expect(s.retries).toEqual({ a: 2 })
  })
})

describe('R2 getNextActions', () => {
  it('action 节点（n-adm）：adjacency 逐目标（label=目标 name）+ 透传 emp/prompt', () => {
    const r = getNextActions(initState('n-adm'), loaded)
    expect(r.current_node).toBe('n-adm')
    expect(r.node_kind).toBe('action')
    expect(r.node_name).toBe('准入')
    expect(r.emp).toBe('sec-compliance')
    expect(r.prompt).toContain('secretgate')
    expect(r.next_actions).toEqual([{ to_node: 'n0-req', label: '需求核验' }])
    expect(r.gate_spec).toBeUndefined()
    expect(r.is_blocked).toBe(false)
    expect(r.blocked_reason).toBeNull()
  })

  it('gate 节点（g-req-review review）：PASS/FAIL 两动作 + gate_spec（current_iter/max_retries）', () => {
    const r = getNextActions(initState('g-req-review'), loaded)
    expect(r.node_kind).toBe('gate')
    expect(r.node_name).toBe('需求评审')
    expect(r.next_actions).toEqual([
      { to_node: 'n1-design', label: 'PASS' },
      { to_node: 'n0-req', label: 'FAIL' },
    ])
    expect(r.gate_spec).toMatchObject({
      gate: 'g-req-review',
      kind: 'review',
      reviewer: 'reviewer-expert',
      on_pass: 'n1-design',
      on_reflow: 'n0-req',
      current_iter: 0,
      max_retries: 6,
    })
    // current_iter 反映 state.gate_iters（非恒 0）
    const r2 = getNextActions(
      { ...initState('g-req-review'), gate_iters: { 'g-req-review': 2 } },
      loaded,
    )
    expect(r2.gate_spec?.current_iter).toBe(2)
  })

  it('decision gate：branches 逐键动作（label=键名）', () => {
    const t = loadNodeTable(
      parseNodeTable({
        flow: 'dec-t',
        nodes: [
          { id: 'd0', kind: 'gate', gate: 'gd', next: ['ok', 't2'] },
          { id: 'ok', kind: 'terminal', next: [] },
          { id: 't2', kind: 'terminal', next: [] },
        ],
        gate_specs: {
          gd: { kind: 'decision', reviewer: 'r', branches: { approve: 'ok', reject: 't2' } },
        },
      }),
    )
    const r = getNextActions(initState('d0'), t)
    expect(r.next_actions).toEqual([
      { to_node: 'ok', label: 'approve' },
      { to_node: 't2', label: 'reject' },
    ])
    expect(r.gate_spec?.kind).toBe('decision')
  })

  it('terminal 节点（n-done）：next_actions 空', () => {
    const r = getNextActions(initState('n-done'), loaded)
    expect(r.node_kind).toBe('terminal')
    expect(r.node_name).toBe('交付清点')
    expect(r.next_actions).toEqual([])
  })

  it("gate 节点 gate_specs 成员判定不踩原型链（gate id='toString' 回归锚）", () => {
    // 手搓表绕过 parseNodeTable（schema 层对该形态报错；此处锁定 getNextActions 自身
    // 的成员判定：不在 specs 的 gate 按 else 分支走 adjacency，不产 gate_spec）
    const t = loadNodeTable({
      flow: 'proto-t',
      max_retries: 3,
      terminal_fail: null,
      nodes: [
        { id: 'g', kind: 'gate' as const, gate: 'toString', next: ['b'] },
        { id: 'b', kind: 'terminal' as const, next: [] },
      ],
      gate_specs: {},
    })
    const r = getNextActions(initState('g'), t)
    expect(r.gate_spec).toBeUndefined()
    expect(r.next_actions).toEqual([{ to_node: 'b', label: 'b' }])
  })

  it('blocked state：next_actions 空 + is_blocked/blocked_reason 透出', () => {
    const r = getNextActions(
      { ...initState('n-adm'), status: 'blocked', blocked_reason: 'mock spawn failed' },
      loaded,
    )
    expect(r.is_blocked).toBe(true)
    expect(r.blocked_reason).toBe('mock spawn failed')
    expect(r.next_actions).toEqual([])
  })

  it('current_node 为 null：裸信息（node_kind null）', () => {
    const r = getNextActions(initState(null), loaded)
    expect(r.current_node).toBeNull()
    expect(r.node_kind).toBeNull()
    expect(r.node_name).toBeNull()
    expect(r.next_actions).toEqual([])
  })
})

describe('R2 position（里程碑：total=gate 数+成功终点）', () => {
  it('n-adm 位 {cleared:0,total:6,pct:0}', () => {
    expect(position(loaded, 'n-adm')).toEqual({ cleared: 0, total: 6, pct: 0 })
  })

  it('n2-impl 位（过 3 gate）{cleared:3,total:6,pct:50}', () => {
    expect(position(loaded, 'n2-impl')).toEqual({ cleared: 3, total: 6, pct: 50 })
  })

  it('n-done {cleared:6,total:6,pct:100}', () => {
    expect(position(loaded, 'n-done')).toEqual({ cleared: 6, total: 6, pct: 100 })
  })

  it('n-fail（fail-sink）/ null / 未知节点 → null', () => {
    expect(position(loaded, 'n-fail')).toBeNull()
    expect(position(loaded, null)).toBeNull()
    expect(position(loaded, 'nX')).toBeNull()
  })
})
