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
  it('employees 域路由表 = POST /api/employees/generate + GET /api/employees/validate-id', () => {
    const reg = createRegistry()
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    registerEmployeesRoutes(reg, { builder, store })
    expect(reg.routes.map((r) => [r.method, r.path]).sort()).toEqual([
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
})
