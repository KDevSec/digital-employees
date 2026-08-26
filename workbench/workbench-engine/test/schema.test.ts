import { describe, expect, it } from 'vitest'
import { EngineSchemaError, parseNodeTable } from '../src/schema/node-table'

/** 最小合法表——各用例在其副本上变异出非法形态（1.0 load_node_table 校验语义锚） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseTable(): any {
  return {
    flow: 't-flow',
    nodes: [
      { id: 'a', kind: 'action', emp: 'e1', next: ['g1'] },
      { id: 'g1', kind: 'gate', gate: 'g1', next: ['b', 'a'] },
      { id: 'b', kind: 'terminal', next: [] },
    ],
    gate_specs: { g1: { kind: 'review', reviewer: 'r1', on_pass: 'b', on_reflow: 'a' } },
  }
}

/** 断言抛 EngineSchemaError 且 message 含全部给定定位子串 */
const reject = (raw: unknown, ...locate: string[]) => {
  expect(() => parseNodeTable(raw)).toThrow(EngineSchemaError)
  for (const s of locate) expect(() => parseNodeTable(raw)).toThrow(s)
}

describe('parseNodeTable 非法表用例集', () => {
  it('nodes 空数组', () => {
    const t = baseTable()
    t.nodes = []
    reject(t, 'nodes')
  })

  it('nodes 非数组', () => {
    const t = baseTable()
    t.nodes = 'x'
    reject(t, 'nodes')
  })

  it('节点 id 重复', () => {
    const t = baseTable()
    t.nodes.push({ id: 'a', kind: 'action', next: ['b'] })
    reject(t, "node 'a'", 'id 重复')
  })

  it("kind:'workflow' 非法枚举", () => {
    const t = baseTable()
    t.nodes[0].kind = 'workflow'
    reject(t, 'kind', 'workflow')
  })

  it("next 指向不存在节点", () => {
    const t = baseTable()
    t.nodes[0].next = ['a', 'nX']
    reject(t, "node 'a'", "next 指向不存在节点 'nX'")
  })

  it('terminal 节点 next 非空', () => {
    const t = baseTable()
    t.nodes[2].next = ['a']
    reject(t, "node 'b'", 'terminal')
  })

  it('gate 节点缺 gate 字段', () => {
    const t = baseTable()
    delete t.nodes[1].gate
    reject(t, "node 'g1'", 'gate 节点缺少 gate 字段')
  })

  it('gate 字段值不在 gate_specs', () => {
    const t = baseTable()
    t.nodes[1].gate = 'g-other'
    reject(t, "node 'g1'", "'g-other'", 'gate_specs')
  })

  it('review spec 缺 on_pass', () => {
    const t = baseTable()
    delete t.gate_specs.g1.on_pass
    reject(t, 'g1', 'on_pass')
  })

  it('on_pass 指向不存在节点', () => {
    const t = baseTable()
    t.gate_specs.g1.on_pass = 'nX'
    reject(t, "gate_spec 'g1'", "on_pass 指向不存在节点 'nX'")
  })

  it('decision spec 缺 branches', () => {
    const t = baseTable()
    t.gate_specs.g1 = { kind: 'decision', reviewer: 'r1' }
    reject(t, 'g1', 'branches')
  })

  it('terminal_fail 指向非 terminal 节点', () => {
    const t = baseTable()
    t.terminal_fail = 'a'
    reject(t, "terminal_fail 'a'", '不是 terminal')
  })

  it('terminal_fail 指向不存在节点', () => {
    const t = baseTable()
    t.terminal_fail = 'nX'
    reject(t, "terminal_fail 'nX'", '节点不存在')
  })

  it("human_gate 传字符串 'on'（1.0 YAML1.1 on/off 坑回归锚——布尔严格）", () => {
    const t = baseTable()
    t.nodes[0].human_gate = 'on'
    reject(t, 'human_gate')
  })

  it('未知顶层键（严格 schema 纪律）', () => {
    const t = baseTable()
    t.zzz_unknown_key = 1
    reject(t, 'zzz_unknown_key')
  })

  it('max_retries 为负数', () => {
    const t = baseTable()
    t.max_retries = -1
    reject(t, 'max_retries')
  })
})
