import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { manifestSchema } from '../src/manifest'

const load = (rel: string) =>
  yaml.load(readFileSync(new URL(rel, import.meta.url), 'utf8')) as unknown

describe('manifestSchema 基础结构', () => {
  it('dev-engineer 物料过 schema', () => {
    const m = manifestSchema.parse(load('../../templates/dev-engineer/manifest.yml'))
    expect(m.id).toBe('dev-engineer')
    expect(m.kind).toBe('flow-owner')
    expect(m.agent.persona.usage_modes).toContain('+编排')
  })
  it('未知字段拒绝（strict）', () => {
    const base = load('../../templates/req-clarifier/manifest.yml') as Record<string, unknown>
    expect(() => manifestSchema.parse({ ...base, schema_version: '2.1' })).toThrow()
  })
  it('id 非法格式拒绝', () => {
    const base = load('../../templates/req-clarifier/manifest.yml') as Record<string, unknown>
    expect(() => manifestSchema.parse({ ...base, id: 'Bad_Id' })).toThrow()
  })
})
