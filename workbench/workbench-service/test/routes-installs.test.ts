import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { baseProfiles } from '../src/adapters/index'
import { fixturePackageDir } from '../src/installs/spec/parser'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerInstallsRoutes } from '../src/server/routes/installs'
import type { InstallsRouteDeps } from '../src/server/routes/installs'

/**
 * installs 域路由（设计 §10）：deployments 列表/干跑/执行/漂移检测 + 卸载。
 * - 真实文件 IO（temp staffRoot/registry）——「执行落盘 home、干跑零落盘」是契约本体，不做函数桩；
 * - 探测桩按底座返回 version_tested（Task 7/10 教训：固定版本串会误伤其他底座的版本区间断言）；
 * - auth 源只造 CC 的 .credentials.json（本文件用例只装 claude-code；qoder 三件套见 installs-report.test.ts）；
 * - 错误响应形状 { error: { code, message } }：沿 config 域 PlatformError 风格（web 侧免适配）。
 */

let deps: InstallsRouteDeps

beforeEach(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'wb-routes-in-'))
  const userCc = join(scratch, 'user-cc')
  mkdirSync(userCc, { recursive: true })
  writeFileSync(join(userCc, '.credentials.json'), '{}', 'utf8')
  deps = {
    registryFile: join(scratch, 'registry.json'),
    staffRoot: join(scratch, 'digital-staff'),
    authSourceDirs: { 'claude-code': userCc, codebuddy: '', qoder: '' },
    probe: (base) => ({ present: true, version: baseProfiles[base].version_tested }),
    packageRoots: { 'dev-lite': fixturePackageDir() }, // 员工 id → 包根（E 系列接管前的装配口径）
    employeesRoot: join(scratch, 'employees'), // 终审 B1 回退根——本组用例 packageRoots 已命中，回退不被触达
  }
})

/** 域装配：只挂 installs 域（域行为聚焦；全量汇总表断言在 routes-registry.test.ts） */
function buildApp() {
  const reg = createRegistry()
  registerInstallsRoutes(reg, deps)
  return toHonoApp(reg)
}

/** POST 便捷入口（默认 JSON body） */
async function post(path: string, body: unknown): Promise<Response> {
  return await buildApp().request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('分域注册（routes/installs.ts 只注册本域端点，设计 §10）', () => {
  it('installs 域路由表 = 五端点，无越域', () => {
    const reg = createRegistry()
    registerInstallsRoutes(reg, deps)
    expect(reg.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/deployments',
      'POST /api/deployments/execute',
      'POST /api/deployments/plan',
      'POST /api/deployments/verify',
      'POST /api/uninstall',
    ])
  })
})

describe('POST /api/deployments/execute', () => {
  it('{employee_id, base} → 200 + 安装报告 result=success', async () => {
    const res = await post('/api/deployments/execute', { employee_id: 'dev-lite', base: 'claude-code' })
    expect(res.status).toBe(200)
    const body = await res.json() as { result: string; employee_id: string }
    expect(body.result).toBe('success')
    expect(body.employee_id).toBe('dev-lite')
  })

  it('未知员工 → 404 {error:{code}}（一等错误形状）', async () => {
    const res = await post('/api/deployments/execute', { employee_id: 'ghost', base: 'claude-code' })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND')
  })
})

describe('GET /api/deployments', () => {
  it('安装后列表非空，含 home/status', async () => {
    await post('/api/deployments/execute', { employee_id: 'dev-lite', base: 'claude-code' })
    const res = await buildApp().request('/api/deployments')
    expect(res.status).toBe(200)
    const rows = await res.json() as { employee_id: string; status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('installed')
  })
})

describe('POST /api/deployments/plan（干跑）', () => {
  it('返回 negotiation+placements，不落盘 home（零副作用）', async () => {
    const res = await post('/api/deployments/plan', { employee_id: 'dev-lite', base: 'claude-code' })
    expect(res.status).toBe(200)
    const body = await res.json() as { negotiation: { blocked: unknown }; placements: unknown[] }
    expect(body.negotiation).toBeDefined()
    expect(body.placements.length).toBeGreaterThan(0)
    expect(existsSync(join(deps.staffRoot, 'claude-code', 'dev-lite'))).toBe(false)
  })
})

/**
 * 终审 B1 修复：packageRoots 是注册期快照，新建员工落库后同会话点「安装到底座」必 404
 * （员工实际已在盘上，错误文案与事实不符——只有 7 个预置员工能装）。
 * 回退语义：packageRoots 未命中时按 employee_id 实时探查 employeesRoot/<id> 目录存在则用它作 root。
 * 路径安全：employee_id 走 isSafeEmployeeId 预检——拒 `..`/分隔符/盘符前缀，防 join 越出 employeesRoot。
 */
describe('packageRoots 未命中 → employeesRoot 回退（终审 B1）', () => {
  let fallbackDeps: InstallsRouteDeps

  beforeEach(() => {
    const scratch = mkdtempSync(join(tmpdir(), 'wb-routes-fb-'))
    const userCc = join(scratch, 'user-cc')
    mkdirSync(userCc, { recursive: true })
    writeFileSync(join(userCc, '.credentials.json'), '{}', 'utf8')
    // employeesRoot = fixture packages 父目录 → join(employeesRoot, 'dev-lite') 解析回原 fixture 目录
    fallbackDeps = {
      registryFile: join(scratch, 'registry.json'),
      staffRoot: join(scratch, 'digital-staff'),
      authSourceDirs: { 'claude-code': userCc, codebuddy: '', qoder: '' },
      probe: (base) => ({ present: true, version: baseProfiles[base].version_tested }),
      packageRoots: {}, // 注册期快照为空——逼出回退
      employeesRoot: dirname(fixturePackageDir()),
    }
  })

  function buildFallbackApp() {
    const reg = createRegistry()
    registerInstallsRoutes(reg, fallbackDeps)
    return toHonoApp(reg)
  }

  async function postFallback(path: string, body: unknown): Promise<Response> {
    return await buildFallbackApp().request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('packageRoots 空 + employeesRoot 有 dev-lite → POST plan 200（不再 404）', async () => {
    const res = await postFallback('/api/deployments/plan', { employee_id: 'dev-lite', base: 'claude-code' })
    expect(res.status).toBe(200)
    const body = await res.json() as { negotiation: unknown; placements: unknown[] }
    expect(body.placements.length).toBeGreaterThan(0)
  })

  it('packageRoots 空 + employeesRoot 有 dev-lite → POST execute 200 + result=success', async () => {
    const res = await postFallback('/api/deployments/execute', { employee_id: 'dev-lite', base: 'claude-code' })
    expect(res.status).toBe(200)
    const body = await res.json() as { result: string; employee_id: string }
    expect(body.result).toBe('success')
    expect(body.employee_id).toBe('dev-lite')
  })

  it('employeesRoot 下不存在的 id → 仍 404（与回退不冲突）', async () => {
    const res = await postFallback('/api/deployments/plan', { employee_id: 'ghost', base: 'claude-code' })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND')
  })

  it('路径穿越 id `..` → 仍 404（不查 employeesRoot）', async () => {
    const res = await postFallback('/api/deployments/plan', { employee_id: '..', base: 'claude-code' })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND')
  })

  it('路径分隔符 id `a/b` → 仍 404（不查 employeesRoot）', async () => {
    const res = await postFallback('/api/deployments/plan', { employee_id: 'a/b', base: 'claude-code' })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND')
  })

  it('盘符前缀 id `C:win` → 仍 404（不查 employeesRoot）', async () => {
    const res = await postFallback('/api/deployments/plan', { employee_id: 'C:win', base: 'claude-code' })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('EMPLOYEE_NOT_FOUND')
  })
})
