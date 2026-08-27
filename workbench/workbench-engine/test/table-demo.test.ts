import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { parseNodeTable } from '../src/schema/node-table'
import { engineEventSchema, type EngineEvent } from '../src/schema/events'

/** 契约真源真表：assets/flows/demo-flow.node-table.yml（设计文档 §6.1） */
const tablePath = fileURLToPath(new URL('../assets/flows/demo-flow.node-table.yml', import.meta.url))
const table = parseNodeTable(yamlLoad(readFileSync(tablePath, 'utf8')))

const node = (id: string) => table.nodes.find((n) => n.id === id)!

describe('demo-flow.node-table.yml 经 parseNodeTable 加载', () => {
  it('真表整体解析通过（flow 标识就位）', () => {
    expect(table.flow).toBe('demo-flow')
  })

  it('12 节点清单与顺序', () => {
    expect(table.nodes.map((n) => n.id)).toEqual([
      'n-adm', 'n0-req', 'g-req-review', 'n1-design', 'g-design-review', 'g-sec-design',
      'n2-impl', 'g-code-review', 'g-sec-code', 'n3-sec', 'n-done', 'n-fail',
    ])
  })

  it('五个 gate_spec 逐一断言（reviewer/on_pass/on_reflow/covers）', () => {
    expect(table.gate_specs['g-req-review']).toEqual({
      kind: 'review', reviewer: 'reviewer-expert', on_pass: 'n1-design',
      on_reflow: 'n0-req', covers: ['n0-req'],
    })
    expect(table.gate_specs['g-design-review']).toEqual({
      kind: 'review', reviewer: 'reviewer-expert', on_pass: 'g-sec-design',
      on_reflow: 'n1-design', covers: ['n1-design'],
    })
    expect(table.gate_specs['g-sec-design']).toEqual({
      kind: 'review', reviewer: 'sec-design', on_pass: 'n2-impl',
      on_reflow: 'n1-design', covers: ['n1-design'],
    })
    expect(table.gate_specs['g-code-review']).toEqual({
      kind: 'review', reviewer: 'reviewer-expert', on_pass: 'g-sec-code',
      on_reflow: 'n2-impl', covers: ['n2-impl'],
    })
    expect(table.gate_specs['g-sec-code']).toEqual({
      kind: 'review', reviewer: 'sec-code', on_pass: 'n3-sec',
      on_reflow: 'n2-impl', covers: ['n2-impl'],
    })
  })

  it('抽样字段：model_tier / emp / prompt 模板变量', () => {
    expect(node('n2-impl').model_tier).toBe('编码档')
    expect(node('n-adm').emp).toBe('sec-compliance')
    expect(node('n0-req').prompt).toContain('{{input}}')
    expect(node('n1-design').prompt).toContain('{{run.workspace}}')
    expect(node('n3-sec').prompt).toContain('占位')
  })

  it('表级字段：max_retries / terminal_fail / delivery_node / display_name', () => {
    expect(table.flow).toBe('demo-flow')
    expect(table.display_name).toBe('五阶段演示交付')
    expect(table.version).toBe(1)
    expect(table.max_retries).toBe(6)
    expect(table.terminal_fail).toBe('n-fail')
    expect(table.delivery_node).toBe('n-done')
  })

  it('默认值归一：human_gate 缺省 false（1.0 YAML1.1 坑的对偶面）', () => {
    expect(node('n-adm').human_gate).toBe(false) // YAML 未写 → 归一 false
    expect(node('n0-req').human_gate).toBe(false) // YAML 显式 false → 布尔非字符串
  })
})

describe('engineEventSchema 冒烟（discriminated union on type）', () => {
  const base = {
    seq: 3,
    ts: '2026-08-26T10:00:00.000Z',
    trace_id: 'task-1',
    parent_seq: null,
    actor: 'engine',
    flow: 'demo-flow',
  }

  it('transition 事件通过并保留载荷', () => {
    const e: EngineEvent = engineEventSchema.parse({
      ...base, type: 'transition', from: 'n-adm', to: 'n0-req', status: 'in_progress',
    })
    expect(e.type).toBe('transition')
    expect(e.to).toBe('n0-req')
  })

  it('gate 事件通过并保留载荷', () => {
    const e: EngineEvent = engineEventSchema.parse({
      ...base, type: 'gate', gate: 'g-req-review', kind: 'review', node: 'g-req-review',
      verdict: 'PASS', iter: 1, reviewer: 'reviewer-expert',
    })
    expect(e.gate).toBe('g-req-review')
    expect(e.verdict).toBe('PASS')
  })

  it('缺通用必填键 seq 报错', () => {
    expect(() =>
      engineEventSchema.parse({
        ts: base.ts, trace_id: base.trace_id, parent_seq: null,
        actor: 'engine', flow: 'demo-flow', type: 'transition', from: 'a', to: 'b',
      }),
    ).toThrow()
  })

  it('transition 携带 gate 专属键 verdict 报错（载荷按 type 收窄）', () => {
    expect(() =>
      engineEventSchema.parse({ ...base, type: 'transition', from: 'a', to: 'b', verdict: 'PASS' }),
    ).toThrow()
  })
})
