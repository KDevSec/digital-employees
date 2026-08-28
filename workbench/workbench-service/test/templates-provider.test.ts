import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'

/**
 * templates provider（Task 7 / B2）：
 * - builtin 内存资产（templates.gen.ts 键集）+ custom fs 聚合（customRoot/* 目录扫描）；
 * - manifest 解析走 js-yaml + manifestSchema.parse；解析失败跳过该模板并收集到 provider.errors；
 * - listSkills 跨模板聚合 + 按 name 首见去重（builtin 先、custom 后）；
 * - SKILL.md frontmatter description 取值（js-yaml + skillFrontmatterSchema 不强制走，但描述失败给 ''）。
 */

let customRoot: string

beforeEach(() => {
  customRoot = mkdtempSync(join(tmpdir(), 'wb-templates-prov-'))
})

/** 写一个最小合法 custom 模板（带 1 skill）到 tmp customRoot */
function writeCustomTemplate(
  root: string,
  tplId = 'custom-test',
  opts: { skillName?: string; skillVersion?: string; manifest?: string } = {},
): void {
  const dir = join(root, tplId)
  mkdirSync(dir, { recursive: true })
  const skillName = opts.skillName ?? 'custom-skill'
  const skillVersion = opts.skillVersion ?? '1.0.0'
  const manifest =
    opts.manifest ??
    `id: ${tplId}
display: 自定义测试
brief: 测试用自定义模板
avatar: "🧪"
version: 0.1.0
upp_version: "2.1"
kind: flow-owner
org: local
operator: demo@devzero.local
requires: {level: L1}
agent:
  persona:
    role: 测试
    identity: 测试用身份描述至少十个字符
    principles: []
    usage_modes: [裸用]
skills:
  - {name: ${skillName}, version: ${skillVersion}, source_type: template}
commands: commands/
knowledge: knowledge/
governance:
  level: L1
  visibility: team
  audit: exceptions-only
`
  writeFileSync(join(dir, 'manifest.yml'), manifest, 'utf8')

  const skillDir = join(dir, 'skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${skillName}
description: A custom skill for testing aggregation and dedup behavior
---
`,
    'utf8',
  )
}

describe('createTemplatesProvider — list()', () => {
  it('builtin 7 模板先（manifest 键序即字母序），custom 后；customRoot 不存在不炸（仅 builtin）', () => {
    const provider = createTemplatesProvider(builtinTemplates, '/nonexistent/custom/root')
    const items = provider.list()
    expect(items.length).toBe(7)
    expect(items.every((i) => i.builtin === true)).toBe(true)
    // 字母序：dev-engineer / req-clarifier / reviewer-expert / sec-code / sec-compliance / sec-design / sys-engineer
    expect(items.map((i) => i.id)).toEqual([
      'dev-engineer',
      'req-clarifier',
      'reviewer-expert',
      'sec-code',
      'sec-compliance',
      'sec-design',
      'sys-engineer',
    ])
  })

  it('customRoot 空目录（无子目录）→ 仅 builtin，不炸', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    expect(provider.list().length).toBe(7)
  })

  it('custom 模板聚合：8 个模板，custom 项 builtin=false 且排末位', () => {
    writeCustomTemplate(customRoot)
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const items = provider.list()
    expect(items.length).toBe(8)
    const customItems = items.filter((i) => !i.builtin)
    expect(customItems.length).toBe(1)
    expect(customItems[0]?.id).toBe('custom-test')
    expect(customItems[0]?.display).toBe('自定义测试')
    expect(customItems[0]?.kind).toBe('flow-owner')
    expect(customItems[0]?.level).toBe('L1')
    expect(customItems[0]?.skillsCount).toBe(1)
    expect(customItems[0]?.builtin).toBe(false)
    // custom 排末位（builtin 7 个先、custom 1 个后）
    expect(items[7]?.id).toBe('custom-test')
  })

  it('坏 manifest（不合规）的 custom 模板跳过 + 收集到 errors；list() 不炸', () => {
    // missing id — schema 拒
    writeCustomTemplate(customRoot, 'bad-template', {
      manifest: `display: 坏模板
brief: 缺 id 字段
avatar: ""
version: 0.1.0
upp_version: "2.1"
kind: flow-owner
org: local
operator: demo@devzero.local
requires: {level: L1}
agent:
  persona:
    role: 测试
    identity: 测试用身份描述至少十个字符
    principles: []
    usage_modes: [裸用]
commands: commands/
knowledge: knowledge/
governance:
  level: L1
  visibility: team
  audit: exceptions-only
`,
    })
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const items = provider.list()
    // 坏模板跳过 → 仅 builtin 7
    expect(items.length).toBe(7)
    expect(items.find((i) => i.id === 'bad-template')).toBeUndefined()
    // errors 收集
    expect(provider.errors.length).toBeGreaterThan(0)
    expect(provider.errors.some((e) => e.includes('bad-template'))).toBe(true)
  })

  it('builtin manifest 解析（dev-engineer）：skillsCount=5、kind=flow-owner、level=L2', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const items = provider.list()
    const dev = items.find((i) => i.id === 'dev-engineer')
    expect(dev).toBeDefined()
    expect(dev?.kind).toBe('flow-owner')
    expect(dev?.level).toBe('L2')
    expect(dev?.skillsCount).toBe(5)
    expect(dev?.avatar).toBe('🧑‍💻')
  })
})

describe('createTemplatesProvider — read()', () => {
  it('read builtin manifest 相对路径返回内容（与 builtinTemplates 同值）', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    expect(provider.read('dev-engineer/manifest.yml')).toBe(
      builtinTemplates['dev-engineer/manifest.yml'] ?? null,
    )
  })

  it('read builtin SKILL.md 相对路径返回内容', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const got = provider.read('dev-engineer/skills/tdd-methodology/SKILL.md')
    expect(got).not.toBeNull()
    expect(got).toBe(builtinTemplates['dev-engineer/skills/tdd-methodology/SKILL.md'] ?? null)
  })

  it('read 不存在的相对键 → null（不炸）', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    expect(provider.read('nonexistent/manifest.yml')).toBeNull()
    expect(provider.read('whatever')).toBeNull()
  })

  it('read custom 模板的 manifest 与 SKILL.md（走 fs）', () => {
    writeCustomTemplate(customRoot)
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const m = provider.read('custom-test/manifest.yml')
    expect(m).not.toBeNull()
    expect(m).toContain('id: custom-test')
    const s = provider.read('custom-test/skills/custom-skill/SKILL.md')
    expect(s).not.toBeNull()
    expect(s).toContain('name: custom-skill')
  })

  it('customRoot 不存在时 read custom 路径 → null', () => {
    const provider = createTemplatesProvider(builtinTemplates, '/nonexistent')
    expect(provider.read('custom-test/manifest.yml')).toBeNull()
  })
})

describe('createTemplatesProvider — listSkills()', () => {
  it('builtin 全集跨模板聚合：dev-engineer 5 + req-clarifier 5 + reviewer-expert 1 + sys-engineer 5 + sec-design 1 + sec-code 1 + sec-compliance 1 = 19（无 custom）', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const skills = provider.listSkills()
    // builtin 19
    const builtinSkills = skills.filter((s) => s.builtin)
    expect(builtinSkills.length).toBe(19)
    // 所有都标 builtin=true
    expect(skills.every((s) => s.templateId.length > 0)).toBe(true)
  })

  it('listSkills 跨模板聚合 + custom：20 = 19 builtin + 1 custom', () => {
    writeCustomTemplate(customRoot)
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const skills = provider.listSkills()
    const custom = skills.filter((s) => !s.builtin)
    expect(custom.length).toBe(1)
    expect(custom[0]?.name).toBe('custom-skill')
    expect(custom[0]?.templateId).toBe('custom-test')
    expect(custom[0]?.builtin).toBe(false)
    expect(custom[0]?.version).toBe('1.0.0')
    expect(custom[0]?.description.length).toBeGreaterThan(0)
  })

  it('listSkills 按 name 首见去重：custom 与 builtin 同名 skill → builtin 胜出（version=builtin 的）', () => {
    // builtin 已有 tdd-methodology@1.0.0（dev-engineer）
    writeCustomTemplate(customRoot, 'dup-test', {
      skillName: 'tdd-methodology',
      skillVersion: '9.9.9',
    })
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const skills = provider.listSkills()
    const tdd = skills.filter((s) => s.name === 'tdd-methodology')
    // 首见胜出 → 1 条（builtin 的）
    expect(tdd.length).toBe(1)
    expect(tdd[0]?.builtin).toBe(true)
    expect(tdd[0]?.version).toBe('1.0.0')
    expect(tdd[0]?.templateId).toBe('dev-engineer')
  })

  it('listSkills description 取自 SKILL.md frontmatter（builtin tdd-methodology：非空）', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const skills = provider.listSkills()
    const tdd = skills.find((s) => s.name === 'tdd-methodology')
    expect(tdd).toBeDefined()
    expect(tdd?.description.length).toBeGreaterThan(0)
  })

  it('listSkills 内 custom SKILL.md frontmatter 缺失 description → 该 skill description=""，不炸', () => {
    writeCustomTemplate(customRoot, 'no-desc-tpl', { skillName: 'nodesc-skill' })
    // 覆写 SKILL.md 为缺 description 的版本
    const skPath = join(customRoot, 'no-desc-tpl', 'skills', 'nodesc-skill', 'SKILL.md')
    writeFileSync(skPath, `---
name: nodesc-skill
---
body without description
`, 'utf8')
    // 同步改 manifest 的 skill name
    const mPath = join(customRoot, 'no-desc-tpl', 'manifest.yml')
    writeFileSync(mPath, `id: no-desc-tpl
display: 无描述模板
brief: 测试缺 description
avatar: ""
version: 0.1.0
upp_version: "2.1"
kind: flow-owner
org: local
operator: demo@devzero.local
requires: {level: L1}
agent:
  persona:
    role: 测试
    identity: 测试用身份描述至少十个字符
    principles: []
    usage_modes: [裸用]
skills:
  - {name: nodesc-skill, version: 1.0.0, source_type: template}
commands: commands/
knowledge: knowledge/
governance:
  level: L1
  visibility: team
  audit: exceptions-only
`, 'utf8')
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const skills = provider.listSkills()
    const nodesc = skills.find((s) => s.name === 'nodesc-skill')
    expect(nodesc).toBeDefined()
    expect(nodesc?.description).toBe('')
  })

  it('listSkills 与 list() 一致性：custom 模板不在 list() 时其 skill 不在 listSkills()', () => {
    // 不写 custom → 仅 builtin
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    expect(provider.listSkills().every((s) => s.builtin)).toBe(true)
    expect(existsSync(customRoot)).toBe(true)
  })
})

describe('createTemplatesProvider — customRoot 暴露', () => {
  it('provider.customRoot === 传入的 customRoot', () => {
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    expect(provider.customRoot).toBe(customRoot)
  })
})
