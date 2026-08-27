/**
 * hooks 编译器（Task 10 / B5）：redlines compiled + tools.deny → PreToolUse + W3 polyglot 命令格式。
 *
 * 输入：Manifest；输出：hooks.json 文本（JSON.stringify 两空格缩进）；null = 无 compiled 红线且 deny 空。
 * 命令格式（W3 规范锚）：`"${DEVZERO_HOOKS_ROOT}/redlines/run-hook.cmd" <rule_id>.py`
 *
 * 测试：
 *  ① dev-engineer manifest → 编译输出与物料 hooks.json deep-equal（物料重生成后对齐）
 *  ② 无 compiled 红线且 deny 空 → null
 *  ③ deny 非空 → 条目出现且 matcher=工具名
 *  ④ 命令格式断言含 run-hook.cmd 与 .py 后缀
 *  ⑤ 无 compiled（全 false）但有 deny → 只有 deny 条目
 *  + matcher 映射逐规则覆盖 + description 文案 + 7 模板物料对齐全集
 */
import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { manifestSchema } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../src/assets/templates.gen'
import { compileHooks } from '../src/employees/hooks-compiler'

const TEMPLATE_IDS = [
  'dev-engineer',
  'req-clarifier',
  'reviewer-expert',
  'sec-code',
  'sec-compliance',
  'sec-design',
  'sys-engineer',
] as const

function parseManifest(tplId: string): Manifest {
  const text = builtinTemplates[`${tplId}/manifest.yml`]
  if (text === undefined) throw new Error(`manifest.yml 缺失：${tplId}`)
  const doc = yaml.load(text)
  return manifestSchema.parse(doc) as Manifest
}

// 与 cross-field.test.ts / derive.test.ts 同款手写合法基底（不读文件，规则用例要精确控制字段）
const baseManifest = {
  id: 'test-emp',
  display: '测试员工',
  brief: '测试',
  avatar: '',
  version: '0.1.0',
  upp_version: '2.1' as const,
  kind: 'flow-owner' as const,
  org: 'local',
  operator: 'demo@devzero.local',
  requires: { level: 'L1' as const },
  agent: {
    persona: {
      role: '测试',
      identity: '测试身份描述至少十字符',
      principles: [],
      usage_modes: ['裸用' as const],
    },
  },
  skills: [],
  hooks: { redlines: [] },
  tools: { deny: [] },
  commands: 'commands/',
  knowledge: 'knowledge/',
  connectors: [],
  custom: {},
  constraints: {},
  governance: {
    level: 'L3' as const,
    visibility: 'team' as const,
    audit: 'exceptions-only' as const,
  },
}

function parse(overrides: Record<string, unknown> = {}): Manifest {
  return manifestSchema.parse({ ...baseManifest, ...overrides }) as Manifest
}

describe('compileHooks — ① dev-engineer 物料对齐', () => {
  it('dev-engineer manifest → compileHooks 输出 JSON.parse 与物料 hooks.json JSON.parse deep-equal', () => {
    const manifest = parseManifest('dev-engineer')
    const output = compileHooks(manifest)
    expect(output).not.toBeNull()
    const expectedText = builtinTemplates['dev-engineer/hooks/hooks.json']
    expect(expectedText).toBeDefined()
    expect(JSON.parse(output!)).toEqual(JSON.parse(expectedText!))
  })
})

describe('compileHooks — ② null 路径', () => {
  it('无 compiled 红线且 deny 空 → null', () => {
    const manifest = parse()
    expect(compileHooks(manifest)).toBeNull()
  })

  it('redlines 全 compiled=false 且 deny 空 → null', () => {
    const manifest = parse({
      hooks: {
        redlines: [{ rule_id: 'no-push-to-main', compiled: false }],
      },
    })
    expect(compileHooks(manifest)).toBeNull()
  })

  it('redlines 含 high-risk-via-gate（无 matcher 映射，compiled=true）但 deny 空 → null（无产出条目）', () => {
    const manifest = parse({
      hooks: {
        redlines: [{ rule_id: 'high-risk-via-gate', compiled: true }],
      },
    })
    expect(compileHooks(manifest)).toBeNull()
  })
})

describe('compileHooks — ③ deny 条目', () => {
  it('deny 非空 → 条目出现且 matcher=工具名', () => {
    const manifest = parse({
      tools: { deny: ['WebFetch'] },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse).toHaveLength(1)
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('WebFetch')
  })

  it('deny 多项 → 多条目（每项独立）', () => {
    const manifest = parse({
      tools: { deny: ['WebFetch', 'TodoWrite'] },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse).toHaveLength(2)
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('WebFetch')
    expect(parsed.hooks.PreToolUse[1].matcher).toBe('TodoWrite')
  })

  it('deny 顺序保持 manifest.tools.deny 顺序', () => {
    const manifest = parse({
      tools: { deny: ['TodoWrite', 'WebFetch'] },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('TodoWrite')
    expect(parsed.hooks.PreToolUse[1].matcher).toBe('WebFetch')
  })
})

describe('compileHooks — ④ 命令格式（W3 polyglot）', () => {
  it('红线命令含 run-hook.cmd 与 .py 后缀', () => {
    const manifest = parse({
      hooks: {
        redlines: [{ rule_id: 'no-push-to-main', compiled: true }],
      },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    const cmd = parsed.hooks.PreToolUse[0].hooks[0].command
    expect(cmd).toContain('run-hook.cmd')
    expect(cmd).toContain('.py')
    expect(cmd).toContain('no-push-to-main')
  })

  it('deny 命令含 run-hook.cmd 与 .py 后缀', () => {
    const manifest = parse({
      tools: { deny: ['WebFetch'] },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    const cmd = parsed.hooks.PreToolUse[0].hooks[0].command
    expect(cmd).toContain('run-hook.cmd')
    expect(cmd).toContain('.py')
  })

  it('命令 timeout=5', () => {
    const manifest = parse({
      hooks: {
        redlines: [{ rule_id: 'no-push-to-main', compiled: true }],
      },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(5)
  })

  it('命令 type=command', () => {
    const manifest = parse({
      hooks: {
        redlines: [{ rule_id: 'no-push-to-main', compiled: true }],
      },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse[0].hooks[0].type).toBe('command')
  })
})

describe('compileHooks — ⑤ 无 compiled 但有 deny → 只有 deny 条目', () => {
  it('redlines 全 compiled=false 但 deny 非空 → 只有 deny 条目', () => {
    const manifest = parse({
      hooks: {
        redlines: [
          { rule_id: 'no-push-to-main', compiled: false },
          { rule_id: 'no-devzero-state', compiled: false },
        ],
      },
      tools: { deny: ['WebFetch'] },
    })
    const output = compileHooks(manifest)!
    const parsed = JSON.parse(output)
    expect(parsed.hooks.PreToolUse).toHaveLength(1)
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('WebFetch')
  })
})

describe('compileHooks — matcher 映射（W3 规范锚）', () => {
  it('no-push-to-main → Bash', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-push-to-main', compiled: true }] },
    })
    expect(JSON.parse(compileHooks(manifest)!).hooks.PreToolUse[0].matcher).toBe('Bash')
  })

  it('no-devzero-state → Write|Edit|MultiEdit|Bash', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-devzero-state', compiled: true }] },
    })
    expect(JSON.parse(compileHooks(manifest)!).hooks.PreToolUse[0].matcher).toBe('Write|Edit|MultiEdit|Bash')
  })

  it('no-external-request → Bash', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-external-request', compiled: true }] },
    })
    expect(JSON.parse(compileHooks(manifest)!).hooks.PreToolUse[0].matcher).toBe('Bash')
  })

  it('no-production-access → Bash', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-production-access', compiled: true }] },
    })
    expect(JSON.parse(compileHooks(manifest)!).hooks.PreToolUse[0].matcher).toBe('Bash')
  })

  it('no-db-schema → Write|Edit|MultiEdit', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-db-schema', compiled: true }] },
    })
    expect(JSON.parse(compileHooks(manifest)!).hooks.PreToolUse[0].matcher).toBe('Write|Edit|MultiEdit')
  })
})

describe('compileHooks — description 文案', () => {
  it('description 含 compiled 规则 id 列表 + T10 注记', () => {
    const manifest = parse({
      hooks: {
        redlines: [
          { rule_id: 'no-push-to-main', compiled: true },
          { rule_id: 'no-devzero-state', compiled: true },
        ],
      },
    })
    const parsed = JSON.parse(compileHooks(manifest)!)
    expect(parsed.description).toBe(
      '由 devzero 从红线声明编译生成，请勿手改（重新生成会覆盖）。规则：no-push-to-main, no-devzero-state（已定格，T10 2026-08-27）',
    )
  })

  it('description 规则顺序 = manifest.redlines 顺序（compiled 项）', () => {
    const manifest = parse({
      hooks: {
        redlines: [
          { rule_id: 'no-devzero-state', compiled: true },
          { rule_id: 'no-push-to-main', compiled: true },
        ],
      },
    })
    const parsed = JSON.parse(compileHooks(manifest)!)
    expect(parsed.description).toContain('no-devzero-state, no-push-to-main')
  })

  it('deny-only description 规则列表为空但保留 T10 注记', () => {
    const manifest = parse({
      tools: { deny: ['WebFetch'] },
    })
    const parsed = JSON.parse(compileHooks(manifest)!)
    expect(parsed.description).toBe(
      '由 devzero 从红线声明编译生成，请勿手改（重新生成会覆盖）。规则：（已定格，T10 2026-08-27）',
    )
  })
})

describe('compileHooks — 7 模板物料对齐全集（物料重生成后须全过）', () => {
  for (const tplId of TEMPLATE_IDS) {
    it(`${tplId}: compileHooks(manifest) JSON.parse 与物料 hooks.json JSON.parse deep-equal`, () => {
      const manifest = parseManifest(tplId)
      const output = compileHooks(manifest)
      const expectedText = builtinTemplates[`${tplId}/hooks/hooks.json`]
      expect(expectedText).toBeDefined()
      // null 路径断言：无 compiled 红线且 deny 空的模板（理论上 7 模板都有 compiled，所以应非 null）
      expect(output).not.toBeNull()
      expect(JSON.parse(output!)).toEqual(JSON.parse(expectedText!))
    })
  }
})

describe('compileHooks — 输出 JSON 格式（两空格缩进）', () => {
  it('输出可被 JSON.parse 且使用两空格缩进', () => {
    const manifest = parse({
      hooks: { redlines: [{ rule_id: 'no-push-to-main', compiled: true }] },
    })
    const output = compileHooks(manifest)!
    // 两空格缩进断言：第一行后含 "\n  "（两空格）
    expect(output).toContain('\n  ')
    // 可解析为合法 JSON
    expect(() => JSON.parse(output)).not.toThrow()
  })
})
