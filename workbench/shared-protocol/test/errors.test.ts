import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { validateManifest } from '../src/errors'
import type { ValidationIssue, ValidationResult } from '../src/errors'

const load = (rel: string) =>
  yaml.load(readFileSync(new URL(rel, import.meta.url), 'utf8')) as unknown

const validBase = () => load('../../templates/dev-engineer/manifest.yml') as Record<string, unknown>

describe('validateManifest', () => {
  it('合法 manifest（dev-engineer 物料）→ valid:true, issues:[]', () => {
    const r = validateManifest(validBase())
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
  })

  it('反例1: 缺 display → valid:false, issues 中存在 path="display"', () => {
    const { display: _d, ...noDisplay } = validBase()
    const r = validateManifest(noDisplay)
    expect(r.valid).toBe(false)
    expect(r.issues.some((i) => i.path === 'display')).toBe(true)
  })

  it('反例2: usage_modes 含 +编排 但 level=L1 → valid:false, issues 中存在 path="requires.level"', () => {
    const r = validateManifest({ ...validBase(), requires: { level: 'L1' } })
    expect(r.valid).toBe(false)
    expect(r.issues.some((i) => i.path === 'requires.level')).toBe(true)
  })

  it('反例3: kind=callee 带 orchestration → valid:false, issues 中存在 path="orchestration"', () => {
    const r = validateManifest({ ...validBase(), kind: 'callee' })
    expect(r.valid).toBe(false)
    expect(r.issues.some((i) => i.path === 'orchestration')).toBe(true)
  })

  it('反例4: connectors stdio 缺 command → valid:false, issues 中存在 path="connectors.0.command"', () => {
    const r = validateManifest({ ...validBase(), connectors: [{ name: 'x', type: 'stdio' }] })
    expect(r.valid).toBe(false)
    expect(r.issues.some((i) => i.path === 'connectors.0.command')).toBe(true)
  })

  it('issues.code 字段为字符串', () => {
    const { display: _d, ...noDisplay } = validBase()
    const r = validateManifest(noDisplay)
    expect(r.issues.length).toBeGreaterThan(0)
    for (const issue of r.issues) {
      expect(typeof issue.code).toBe('string')
    }
  })

  it('返回类型结构：{ valid: boolean; issues: ValidationIssue[] }', () => {
    const r: ValidationResult = validateManifest(validBase())
    expect(typeof r.valid).toBe('boolean')
    expect(Array.isArray(r.issues)).toBe(true)
    // 静态类型校验：ValidationIssue 字段齐
    if (r.issues.length > 0) {
      const issue: ValidationIssue = r.issues[0]
      expect(typeof issue.path).toBe('string')
      expect(typeof issue.code).toBe('string')
      expect(typeof issue.message).toBe('string')
    }
  })
})
