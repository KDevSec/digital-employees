import { describe, it, expect } from 'vitest'
import { manifestSchema } from '../src/manifest'
import type { Manifest } from '../src/manifest'
import { deriveCapabilities, deriveRequires, aggregateTools } from '../src/derive'

// 与 cross-field.test.ts 同款手写合法基底（不读文件，规则用例要精确控制字段）
const baseInput = {
  id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现', avatar: '🧑‍💻',
  version: '0.1.0', upp_version: '2.1', kind: 'flow-owner', org: 'local',
  operator: 'demo@devzero.local', requires: { level: 'L2' },
  agent: { persona: { role: '数字员工·开发岗', identity: '负责把实现计划落成代码的数字员工。', principles: [], usage_modes: ['裸用', '+编排'] } },
  skills: [], hooks: { redlines: [] }, tools: { deny: [] },
  commands: 'commands/', knowledge: 'knowledge/', connectors: [], custom: {},
  constraints: {}, governance: { level: 'L3', visibility: 'team' },
  orchestration: { node_table: 'orchestration/dev-engineer.node-table.yml' },
}

const parse = (overrides: Record<string, unknown> = {}): Manifest =>
  manifestSchema.parse({ ...baseInput, ...overrides }) as Manifest

describe('deriveRequires（推导表五条规则）', () => {
  it('规则1: 恒有 agent-def + fs-access（即使 skills/orchestration/redlines/connectors 全空）', () => {
    const r = deriveRequires(parse())
    expect(r.capabilities).toContain('agent-def')
    expect(r.capabilities).toContain('fs-access')
  })

  it('规则2: skills 非空 → + skill-def', () => {
    const r = deriveRequires(parse({ skills: [{ name: 'a', version: '1.0.0', source_type: 'template' }] }))
    expect(r.capabilities).toContain('skill-def')
  })

  it('规则2 反向: skills 为空 → 不含 skill-def', () => {
    const r = deriveRequires(parse())
    expect(r.capabilities).not.toContain('skill-def')
  })

  it('规则3: orchestration 存在 → + bash-exec + slash-command + subagent-dispatch', () => {
    const r = deriveRequires(parse())
    expect(r.capabilities).toContain('bash-exec')
    expect(r.capabilities).toContain('slash-command')
    expect(r.capabilities).toContain('subagent-dispatch')
  })

  it('规则3 反向: orchestration 缺失（usage_modes 改裸用、level=L0）→ 三者均不含', () => {
    // 必须同步去掉 +编排，否则 R1 第二条会拒（+编排 ⇒ orchestration 必填）
    const { orchestration: _o, ...rest } = baseInput
    const noOrch = {
      ...rest,
      requires: { level: 'L0' },
      agent: { persona: { ...rest.agent.persona, usage_modes: ['裸用'] } },
    }
    const r = deriveRequires(manifestSchema.parse(noOrch) as Manifest)
    expect(r.capabilities).not.toContain('bash-exec')
    expect(r.capabilities).not.toContain('slash-command')
    expect(r.capabilities).not.toContain('subagent-dispatch')
  })

  it('规则4: hooks.redlines 非空 → optional 含 event:PreToolUse', () => {
    const r = deriveRequires(parse({ hooks: { redlines: [{ rule_id: 'no-push-to-main' }] } }))
    expect(r.optional).toContain('event:PreToolUse')
  })

  it('规则4 反向: redlines 空 → optional 不含 event:PreToolUse', () => {
    const r = deriveRequires(parse())
    expect(r.optional).not.toContain('event:PreToolUse')
  })

  it('规则5: connectors 非空 → optional 含 mcp', () => {
    const r = deriveRequires(parse({ connectors: [{ name: 'x', type: 'stdio', command: 'npx foo' }] }))
    expect(r.optional).toContain('mcp')
  })

  it('规则5 反向: connectors 空 → optional 不含 mcp', () => {
    const r = deriveRequires(parse())
    expect(r.optional).not.toContain('mcp')
  })
})

describe('aggregateTools', () => {
  it('并集减 deny，去重，保首见顺序：[Bash,Edit] ∪ [mcp__x__y] ∪ [engine_advance] − [Edit] → [Bash,mcp__x__y,engine_advance]', () => {
    const r = aggregateTools(['Bash', 'Edit'], ['mcp__x__y'], ['engine_advance'], ['Edit'])
    expect(r).toEqual(['Bash', 'mcp__x__y', 'engine_advance'])
  })

  it('跨数组去重保首见：[A,B] ∪ [B,C] ∪ [C,A] − [] → [A,B,C]', () => {
    expect(aggregateTools(['A', 'B'], ['B', 'C'], ['C', 'A'], [])).toEqual(['A', 'B', 'C'])
  })

  it('deny 全集 → 空数组', () => {
    expect(aggregateTools(['A'], [], [], ['A'])).toEqual([])
  })

  it('空输入 → 空数组', () => {
    expect(aggregateTools([], [], [], [])).toEqual([])
  })
})

describe('deriveCapabilities', () => {
  it('每 skill description 首句截断（中文句号 / 英文 ? / 英文 !）', () => {
    const skills = [
      { name: 'a', description: '第一句。第二句不再要。' },
      { name: 'b', description: 'Question? More text.' },
      { name: 'c', description: '感叹!后面不要.' },
    ]
    expect(deriveCapabilities(skills)).toEqual(['第一句', 'Question', '感叹'])
  })

  it('无标点则全文', () => {
    expect(deriveCapabilities([{ name: 'x', description: '没有标点全文一句' }])).toEqual(['没有标点全文一句'])
  })

  it('英文 description 首句截断（典型 frontend-design）', () => {
    const desc = 'Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications.'
    expect(deriveCapabilities([{ name: 'frontend-design', description: desc }])).toEqual([
      'Create distinctive, production-grade frontend interfaces with high design quality',
    ])
  })

  it('空数组 → 空数组', () => {
    expect(deriveCapabilities([])).toEqual([])
  })
})
