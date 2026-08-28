/**
 * employees 域路由（Task 11 / B6，设计：POST /api/employees/generate、GET /api/employees/validate-id）。
 * - 域文件按 routes/config.ts 模式：registerEmployeesRoutes(reg, deps) + EmployeesRouteDeps；
 * - POST /api/employees/generate → 200 GenerateResult / 422 VALIDATION_FAILED（field_errors 含 step）
 *   / 409 ID_CONFLICT / 400 (body 缺 draft)
 * - GET /api/employees/validate-id?id= → { available, suggestion? }（不可用时 suggestion=<id>-2 起递增）
 * 鉴权注记：暂无会话机制（G-1），与 healthz / config / templates 同档「无鉴权」；本机边界 = S-12。
 */
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { manifestSchema } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import { createEmployeeStore } from '../src/employees/store'
import { createEmployeeBuilder } from '../src/employees/builder'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerEmployeesRoutes } from '../src/server/routes/employees'
import type { EmployeeDraft } from '../src/employees/builder'

let base: string
let employeesRoot: string
let tmpRoot: string
let customRoot: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wb-emp-routes-'))
  employeesRoot = join(base, 'employees')
  tmpRoot = join(base, 'tmp')
  customRoot = join(base, 'templates-custom')
})

function parseManifest(tplId: string): Manifest {
  const text = builtinTemplates[`${tplId}/manifest.yml`]
  if (text === undefined) throw new Error(`manifest.yml 缺失：${tplId}`)
  const doc = yaml.load(text)
  return manifestSchema.parse(doc) as Manifest
}

/** 组装 dev-engineer draft（含 template_id 注入位） */
function buildDevEngineerDraft(opts: { id?: string; display?: string } = {}): EmployeeDraft {
  const manifest = JSON.parse(JSON.stringify(parseManifest('dev-engineer'))) as Manifest
  if (opts.id) manifest.id = opts.id
  if (opts.display !== undefined) manifest.display = opts.display
  const skills = manifest.skills.map((s) => ({
    name: s.name,
    version: s.version,
    source_type: 'template' as const,
    template_id: 'dev-engineer',
    description: '',
  }))
  return { manifest, skills }
}

function buildApp() {
  const registry = createRegistry()
  const provider = createTemplatesProvider(builtinTemplates, customRoot)
  const store = createEmployeeStore(employeesRoot, tmpRoot)
  const builder = createEmployeeBuilder({ provider, store, tmpRoot })
  registerEmployeesRoutes(registry, { builder, store })
  return toHonoApp(registry)
}

/** POST 便捷入口 */
async function postGenerate(body: unknown): Promise<Response> {
  return await buildApp().request('/api/employees/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('分域注册（routes/employees.ts 只注册本域端点）', () => {
  it('employees 域路由表 = POST /api/employees/generate + GET /api/employees/validate-id + GET /api/employees', () => {
    const reg = createRegistry()
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    registerEmployeesRoutes(reg, { builder, store })
    expect(reg.routes.map((r) => [r.method, r.path]).sort()).toEqual([
      ['GET', '/api/employees'],
      ['GET', '/api/employees/validate-id'],
      ['POST', '/api/employees/generate'],
    ])
  })
})

describe('POST /api/employees/generate', () => {
  it('200 + GenerateResult（dev-engineer draft → 员工目录落盘）', async () => {
    const draft = buildDevEngineerDraft()
    const res = await postGenerate({ draft })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      package_path: string
      files: string[]
      manifest: Manifest
    }
    expect(json.package_path).toBe(join(employeesRoot, draft.manifest.id))
    expect(Array.isArray(json.files)).toBe(true)
    expect(json.files).toContain('manifest.yml')
    expect(json.files).toContain('AGENTS.md')
    expect(json.manifest.id).toBe(draft.manifest.id)
    // 员工目录真在盘上
    expect(readdirSync(employeesRoot)).toEqual([draft.manifest.id])
  })

  it('422 + VALIDATION_FAILED field_errors 含 step（坏 display）', async () => {
    const draft = buildDevEngineerDraft({ display: '' })
    const res = await postGenerate({ draft })
    expect(res.status).toBe(422)
    const json = (await res.json()) as {
      code: string
      field_errors: Array<{ step: string; field: string; message: string }>
    }
    expect(json.code).toBe('VALIDATION_FAILED')
    expect(Array.isArray(json.field_errors)).toBe(true)
    expect(json.field_errors.length).toBeGreaterThan(0)
    // display 错误的 step 应为 'agent'（FIELD_STEP_MAP: display → agent）
    const displayErr = json.field_errors.find((e) => e.field.includes('display'))
    expect(displayErr).toBeDefined()
    expect(displayErr?.step).toBe('agent')
  })

  it('409 + ID_CONFLICT（同 id 二次 generate）', async () => {
    const draft = buildDevEngineerDraft()
    const res1 = await postGenerate({ draft })
    expect(res1.status).toBe(200)
    const res2 = await postGenerate({ draft })
    expect(res2.status).toBe(409)
    const json = (await res2.json()) as { code: string; message: string }
    expect(json.code).toBe('ID_CONFLICT')
    expect(typeof json.message).toBe('string')
  })

  it('400 (body 缺 draft)', async () => {
    const res = await postGenerate({}) // 无 draft 键
    expect(res.status).toBe(400)
  })

  it('422 + SKILL_MISSING (local skill 缺 temp)', async () => {
    const draft = buildDevEngineerDraft()
    draft.manifest.skills = [
      {
        name: 'missing-local',
        version: '0.1.0',
        source_type: 'local',
        origin: 'uploaded.zip',
      },
    ]
    draft.skills = [
      {
        name: 'missing-local',
        version: '0.1.0',
        source_type: 'local',
        origin: 'uploaded.zip',
        description: '',
      },
    ]
    const res = await postGenerate({ draft })
    expect(res.status).toBe(422)
    const json = (await res.json()) as { code: string; message: string }
    expect(json.code).toBe('SKILL_MISSING')
  })
})

describe('GET /api/employees/validate-id', () => {
  it('available=true（无同 id 员工）', async () => {
    const res = await buildApp().request('/api/employees/validate-id?id=brand-new-id')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { available: boolean; suggestion?: string }
    expect(json.available).toBe(true)
    expect(json.suggestion).toBeUndefined()
  })

  it('available=false + suggestion=<id>-2（已有同 id 员工）', async () => {
    // 先 generate 一个 dev-engineer 占位
    const draft = buildDevEngineerDraft()
    await postGenerate({ draft })
    // 查同 id → 不可用，suggestion = '<id>-2'
    const res = await buildApp().request(`/api/employees/validate-id?id=${draft.manifest.id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { available: boolean; suggestion?: string }
    expect(json.available).toBe(false)
    expect(json.suggestion).toBe(`${draft.manifest.id}-2`)
  })

  it('suggestion 起递增：当 <id>-2 也被占用时返回 <id>-3', async () => {
    const draft = buildDevEngineerDraft()
    // 先占位 <id>
    await postGenerate({ draft })
    // 再占位 <id>-2（用改 id 的 draft）
    const draft2 = buildDevEngineerDraft({ id: `${draft.manifest.id}-2` })
    await postGenerate({ draft: draft2 })
    // 查同 id → suggestion = '<id>-3'
    const res = await buildApp().request(`/api/employees/validate-id?id=${draft.manifest.id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { available: boolean; suggestion?: string }
    expect(json.available).toBe(false)
    expect(json.suggestion).toBe(`${draft.manifest.id}-3`)
  })
})

describe('Host 白名单守卫照常（employees 域）', () => {
  it('POST /api/employees/generate 带 Host: evil.com → 403', async () => {
    const res = await buildApp().request('/api/employees/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'evil.com' },
      body: JSON.stringify({ draft: buildDevEngineerDraft() }),
    })
    expect(res.status).toBe(403)
  })

  it('GET /api/employees/validate-id 带 Host: evil.com → 403', async () => {
    const res = await buildApp().request('/api/employees/validate-id?id=x', {
      headers: { Host: 'evil.com' },
    })
    expect(res.status).toBe(403)
  })

  it('GET /api/employees 带 Host: evil.com → 403', async () => {
    const res = await buildApp().request('/api/employees', { headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/employees（花名册扫描派生）', () => {
  it('空员工库 → 200 + items=[] + invalid=[]', async () => {
    const res = await buildApp().request('/api/employees')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: unknown[]; invalid: unknown[] }
    expect(Array.isArray(json.items)).toBe(true)
    expect(json.items).toEqual([])
    expect(Array.isArray(json.invalid)).toBe(true)
    expect(json.invalid).toEqual([])
  })

  it('materialize 一个假员工后 GET → items 含其卡片字段（id/display/brief/avatar/kind/version）', async () => {
    // 用真实 store 物化一个最小假员工（manifest 含卡片字段）
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const manifestYaml = [
      'id: fake-emp',
      'display: 假员工',
      'brief: 测试用',
      'avatar: 🧪',
      "version: '0.1.0'",
      "upp_version: '2.1'",
      'kind: flow-owner',
      'org: local',
      'operator: demo@devzero.local',
      'requires: {level: L1}',
      'agent:',
      '  persona:',
      '    role: 测试岗',
      '    identity: 测试用假员工身份描述不少于十字',
      '    principles: []',
      '    usage_modes: [裸用]',
      'skills: []',
      'hooks: {redlines: []}',
      'tools: {deny: []}',
      "commands: commands/",
      "knowledge: knowledge/",
      'connectors: []',
      'custom: {}',
      'constraints: {tier: 探索档}',
      'governance: {level: L3, visibility: team, audit: exceptions-only}',
    ].join('\n')
    await store.materialize('fake-emp', [{ path: 'manifest.yml', content: manifestYaml }])

    // 装配 app（store 与上面同一 employeesRoot）
    const registry = createRegistry()
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    registerEmployeesRoutes(registry, { builder, store })
    const app = toHonoApp(registry)

    const res = await app.request('/api/employees')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      items: Array<{ id: string; display: string; brief: string; avatar: string; kind: string; version: string }>
      invalid: string[]
    }
    expect(json.items.length).toBe(1)
    const card = json.items[0]!
    expect(card.id).toBe('fake-emp')
    expect(card.display).toBe('假员工')
    expect(card.brief).toBe('测试用')
    expect(card.avatar).toBe('🧪')
    expect(card.kind).toBe('flow-owner')
    expect(card.version).toBe('0.1.0')
  })

  it('invalid 传递：坏 yaml 目录进 invalid 列表', async () => {
    // 手工构造坏 yaml 目录
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(employeesRoot, 'bad-yaml'), { recursive: true })
    writeFileSync(join(employeesRoot, 'bad-yaml', 'manifest.yml'), '"unclosed string', 'utf8')

    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const registry = createRegistry()
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    registerEmployeesRoutes(registry, { builder, store })
    const app = toHonoApp(registry)

    const res = await app.request('/api/employees')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: unknown[]; invalid: string[] }
    expect(json.invalid).toContain('bad-yaml')
    // 坏 yaml 不在 items 里
    expect(json.items.find((c) => (c as { id: string }).id === 'bad-yaml')).toBeUndefined()
  })

  it('防御性提取：manifest 是对象但字段类型不对 → 兜底空串/undefined', async () => {
    // manifest 字段全错（display 是数字、kind 不在枚举外等）—— yaml 合法但 schema 拒
    // store.list 不过 schema，原样返回；端点做防御性字段提取
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(employeesRoot, 'weird-fields'), { recursive: true })
    // manifest 是合法 yaml 对象，但字段类型与 Manifest 不符（display=数字、kind=未知）
    writeFileSync(
      join(employeesRoot, 'weird-fields', 'manifest.yml'),
      'id: weird-fields\ndisplay: 123\nkind: unknown-kind\nversion: 0.1.0\n',
      'utf8',
    )

    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const registry = createRegistry()
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    registerEmployeesRoutes(registry, { builder, store })
    const app = toHonoApp(registry)

    const res = await app.request('/api/employees')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      items: Array<{ id: string; display: string; brief: string; avatar: string; kind: string; version: string }>
      invalid: string[]
    }
    // weird-fields 不算 invalid（yaml 合法）—— 但字段类型不对，端点做防御性兜底
    expect(json.invalid).not.toContain('weird-fields')
    const card = json.items.find((c) => c.id === 'weird-fields')
    expect(card).toBeDefined()
    // 防御性提取：display 是 number → 兜底空串
    expect(typeof card!.display).toBe('string')
    expect(card!.display).toBe('')
  })
})
