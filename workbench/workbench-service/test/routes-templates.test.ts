import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerTemplatesRoutes } from '../src/server/routes/templates'

/**
 * templates 域路由（Task 7 / B2，设计：GET /api/templates、GET /api/skills）。
 * - 域文件按 routes/config.ts 模式：registerTemplatesRoutes(reg, deps) + TemplatesRouteDeps；
 * - GET /api/templates → { items: TemplateMeta[] }（builtin 先、custom 后）；
 * - GET /api/skills → { items: SkillMeta[] }（按 name 首见去重）。
 * 鉴权注记：暂无会话机制（G-1），与 healthz / config 同档「无鉴权」；本机边界 = S-12。
 */

let customRoot: string

beforeAll(() => {
  customRoot = mkdtempSync(join(tmpdir(), 'wb-routes-tpl-'))
})

/** 域装配：只挂 templates 域（域行为聚焦；全量汇总表断言在 routes-registry.test.ts） */
function buildApp() {
  const registry = createRegistry()
  const templates = createTemplatesProvider(builtinTemplates, customRoot)
  registerTemplatesRoutes(registry, { templates })
  return toHonoApp(registry)
}

describe('分域注册（routes/templates.ts 只注册本域端点）', () => {
  it('templates 域路由表 = GET /api/templates + GET /api/skills', () => {
    const reg = createRegistry()
    const templates = createTemplatesProvider(builtinTemplates, customRoot)
    registerTemplatesRoutes(reg, { templates })
    expect(reg.routes.map((r) => [r.method, r.path]).sort((a, b) => a.join(' ').localeCompare(b.join(' ')))).toEqual([
      ['GET', '/api/skills'],
      ['GET', '/api/templates'],
    ])
  })
})

describe('GET /api/templates', () => {
  it('200 + { items: TemplateMeta[] }；含 7 个 builtin 模板', async () => {
    const res = await buildApp().request('/api/templates')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(Array.isArray(json.items)).toBe(true)
    expect(json.items.length).toBe(7)
    const dev = json.items.find((i) => i.id === 'dev-engineer')
    expect(dev).toBeDefined()
    expect(dev?.display).toBe('开发工程师')
    expect(dev?.kind).toBe('flow-owner')
    expect(dev?.level).toBe('L2')
    expect(dev?.skillsCount).toBe(5)
    expect(dev?.builtin).toBe(true)
  })

  it('响应 items 字段名 = {id,display,brief,avatar,kind,level,skillsCount,builtin}', async () => {
    const res = await buildApp().request('/api/templates')
    const json = (await res.json()) as { items: Array<Record<string, unknown>> }
    const sample = json.items[0]
    expect(sample).toBeDefined()
    expect(Object.keys(sample ?? {}).sort()).toEqual(
      ['avatar', 'brief', 'builtin', 'display', 'id', 'kind', 'level', 'skillsCount'].sort(),
    )
  })
})

describe('GET /api/skills', () => {
  it('200 + { items: SkillMeta[] }；含 16 个 builtin skill（跨模板聚合）', async () => {
    const res = await buildApp().request('/api/skills')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(Array.isArray(json.items)).toBe(true)
    expect(json.items.length).toBe(16)
    const tdd = json.items.find((i) => i.name === 'tdd-methodology')
    expect(tdd).toBeDefined()
    expect(tdd?.version).toBe('1.0.0')
    expect(tdd?.templateId).toBe('dev-engineer')
    expect(tdd?.builtin).toBe(true)
    expect(typeof tdd?.description).toBe('string')
    expect((tdd?.description as string).length).toBeGreaterThan(0)
  })

  it('响应 items 字段名 = {name,version,description,templateId,builtin}', async () => {
    const res = await buildApp().request('/api/skills')
    const json = (await res.json()) as { items: Array<Record<string, unknown>> }
    const sample = json.items[0]
    expect(sample).toBeDefined()
    expect(Object.keys(sample ?? {}).sort()).toEqual(
      ['builtin', 'description', 'name', 'templateId', 'version'].sort(),
    )
  })

  it('按 name 首见去重：listSkills() 返回项 name 唯一', async () => {
    const res = await buildApp().request('/api/skills')
    const json = (await res.json()) as { items: Array<{ name: string }> }
    const names = json.items.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('Host 白名单守卫照常（templates 域）', () => {
  it('GET /api/templates 带 Host: evil.com → 403', async () => {
    const res = await buildApp().request('/api/templates', {
      headers: { Host: 'evil.com' },
    })
    expect(res.status).toBe(403)
  })

  it('GET /api/skills 带 Host: evil.com → 403', async () => {
    const res = await buildApp().request('/api/skills', {
      headers: { Host: 'evil.com' },
    })
    expect(res.status).toBe(403)
  })
})
