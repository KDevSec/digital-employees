import { describe, it, expect } from 'vitest'
import { skillFrontmatterSchema, skillEntrySchema, parseSkillFrontmatter } from '../src/skill'

describe('skillFrontmatterSchema', () => {
  it('合法：name+description（10 字+）', () => {
    expect(skillFrontmatterSchema.safeParse({ name: 'tdd-methodology', description: '测试驱动开发方法论，红绿重构循环。' }).success).toBe(true)
  })
  it('vendored_from/license/version 可选键过', () => {
    expect(skillFrontmatterSchema.safeParse({ name: 'a-skill', description: '描述十个字以上确保过校验。', vendored_from: 'superpowers@6.1.1', license: 'MIT', version: '1.2.0' }).success).toBe(true)
  })
  it('未知键拒（strict）；name 非 slug 拒；description <10 字拒', () => {
    expect(skillFrontmatterSchema.safeParse({ name: 'a-skill', description: '描述十个字以上确保过校验。', extra: 1 }).success).toBe(false)
    expect(skillFrontmatterSchema.safeParse({ name: 'Bad Name', description: '描述十个字以上确保过校验。' }).success).toBe(false)
    expect(skillFrontmatterSchema.safeParse({ name: 'a-skill', description: '太短' }).success).toBe(false)
  })
})

describe('skillEntrySchema', () => {
  it('template 分支：无 template_id 过（fable #1 optional）', () => {
    expect(skillEntrySchema.safeParse({ name: 'x', version: '1.0.0', source_type: 'template' }).success).toBe(true)
  })
  it('local 分支带 origin；agenthub 拒（V0.2 预留）', () => {
    expect(skillEntrySchema.safeParse({ name: 'x', version: '1.0.0', source_type: 'local', origin: 'foo.zip' }).success).toBe(true)
    expect(skillEntrySchema.safeParse({ name: 'x', version: '1.0.0', source_type: 'agenthub' }).success).toBe(false)
  })
})

describe('parseSkillFrontmatter（Task 12 / E-13 抽离）', () => {
  it('合法：---\\n<yaml>\\n---\\n<body> → { ok: true, value: SkillFrontmatter }', () => {
    const md = '---\nname: tdd-methodology\ndescription: 测试驱动开发方法论，红绿重构循环。\nversion: 1.2.3\n---\nbody content\n'
    const r = parseSkillFrontmatter(md)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('tdd-methodology')
      expect(r.value.description).toBe('测试驱动开发方法论，红绿重构循环。')
      expect(r.value.version).toBe('1.2.3')
    }
  })

  it('无 frontmatter 边界（缺首对 ---）→ { ok: false, reason }', () => {
    const md = 'no frontmatter here\njust body\n'
    const r = parseSkillFrontmatter(md)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/边界缺失|---/)
    }
  })

  it('坏 yaml（frontmatter 内 yaml 语法错）→ { ok: false, reason }', () => {
    // yaml 语法错：value 后跟未引用的特殊字符
    const md = '---\nname: : : broken\ndescription: 描述十个字以上确保过校验。\n---\nbody\n'
    const r = parseSkillFrontmatter(md)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/yaml|解析/i)
    }
  })
})

