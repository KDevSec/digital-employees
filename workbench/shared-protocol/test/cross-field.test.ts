import { describe, it, expect } from 'vitest'
import { manifestSchema } from '../src/manifest'
import type { Manifest } from '../src/manifest'

/** 以 dev-engineer 物料语义手写一份合法基底（不读文件，跨字段用例要精确控制） */
const base: Manifest = manifestSchema.parse({
  id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现', avatar: '🧑‍💻',
  version: '0.1.0', upp_version: '2.1', kind: 'flow-owner', org: 'local',
  operator: 'demo@devzero.local', requires: { level: 'L2' },
  agent: { persona: { role: '数字员工·开发岗', identity: '负责把实现计划落成代码的数字员工。', principles: [], usage_modes: ['裸用', '+编排'] } },
  skills: [], hooks: { redlines: [] }, tools: { deny: [] },
  commands: 'commands/', knowledge: 'knowledge/', connectors: [], custom: {},
  constraints: {}, governance: { level: 'L3', visibility: 'team' },
  orchestration: { node_table: 'orchestration/dev-engineer.node-table.yml' },
})

describe('跨字段六规则', () => {
  it('R1: usage_modes 含 +编排 但 level≠L2 → 拒', () => {
    const r = manifestSchema.safeParse({ ...base, requires: { level: 'L1' } })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => JSON.stringify(i.path) === '["requires","level"]')).toBe(true)
  })
  it('R1: +编排 但无 orchestration → 拒', () => {
    const { orchestration: _o, ...noOrch } = base
    expect(manifestSchema.safeParse(noOrch).success).toBe(false)
  })
  it('R2: kind=callee 带 orchestration → 拒', () => {
    const r = manifestSchema.safeParse({ ...base, kind: 'callee' })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'orchestration')).toBe(true)
  })
  it('R3: skills name 重复 → 拒', () => {
    const withDup = { ...base, skills: [
      { name: 'tdd', version: '1.0.0', source_type: 'template' },
      { name: 'tdd', version: '1.0.0', source_type: 'template' }] }
    const r = manifestSchema.safeParse(withDup)
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'skills')).toBe(true)
  })
  it('R4: compiled 红线存在但缺 hooks 字段一致性——schema 层只做声明一致性：redlines 非空+deny 空+无 hooks.json 属安装期校验，schema 不拒', () => {
    expect(manifestSchema.safeParse({ ...base, hooks: { redlines: [{ rule_id: 'no-push-to-main', compiled: true }] } }).success).toBe(true)
  })
  it('R5: connectors stdio 缺 command → 拒；http 缺 url → 拒', () => {
    expect(manifestSchema.safeParse({ ...base, connectors: [{ name: 'x', type: 'stdio' }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...base, connectors: [{ name: 'x', type: 'http' }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...base, connectors: [{ name: 'x', type: 'stdio', command: 'npx foo' }] }).success).toBe(true)
  })
  it('R6: deny 与 connectors 并存不拒（deny 优先 warning 属运行时语义）', () => {
    expect(manifestSchema.safeParse({ ...base, tools: { deny: ['Bash'] } }).success).toBe(true)
  })
})
