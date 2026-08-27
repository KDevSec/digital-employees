import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/server/registry'
import type { Res, Route } from '../src/server/registry'
import { registerAllRoutes } from '../src/server/routes'
import { registerInfraRoutes } from '../src/server/routes/infra'
import { registerShellRoutes } from '../src/server/routes/shell'
import { registerConfigRoutes } from '../src/server/routes/config'
import { registerTemplatesRoutes } from '../src/server/routes/templates'
import { registerEmployeesRoutes } from '../src/server/routes/employees'
import { createTemplatesProvider } from '../src/templates/provider'
import { createEmployeeStore } from '../src/employees/store'
import { createEmployeeBuilder } from '../src/employees/builder'
import { builtinTemplates } from '../src/assets/templates.gen'
import { registerSessionRoutes } from '../src/server/routes/session'
import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig, writeConfigOverride } from '../src/config/load'
import { Engine } from '@devzero/engine'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 路由分域注册约定（I0-5 T1，设计 D-1/D-2/D-3）：
 * routes/<domain>.ts 每域一文件只注册自己的端点，routes/index.ts 静态汇总一行一域，
 * 注册产物 method+path 唯一——I1 并行线撞路由即在此炸，不留给请求期。
 */

/** 域注册依赖：infra 五项 + shell 一项 + config 三项 + templates 一项 + employees 两项（与 main 装配同形状，值非契约） */
/** 编排域引擎夹具（L3 T6）：临时 dataDir/templatesDir（本文件只验路由表结构，不触达 engine 行为——行为断言在 routes-engine.test.ts） */
const engineRoot = mkdtempSync(join(tmpdir(), 'registry-engine-'))
const engine = new Engine({ dataDir: join(engineRoot, 'data'), templatesDir: join(engineRoot, 'flows') })
process.on('exit', () => rmSync(engineRoot, { recursive: true, force: true }))

/** A 系列认证夹具（Task 15）：真实 temp profile（platform-access 首启落 auth/state.key 等文件） */
const profileDir = mkdtempSync(join(tmpdir(), 'wb-registry-'))
const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: 'uid-abc', version: '9.9.9' })

/** 域注册依赖：infra 五项 + shell 一项 + config 三项 + A 系列 platform-access（Task 15 起 service 切片）
 *  + engine 一项（L3 T6）+ installs 五项 + bases 三项（I1 L2 安装线）——与 main 装配同形状，值非契约 */
const deps = {
  version: '9.9.9',
  pid: 4321,
  uid: 'uid-abc',
  dataDir: 'D:/data/.devzero',
  uptime: () => 12_345,
  indexHtml: '<html>DevZero</html>',
  profileDir,
  loadConfig,
  writeConfigOverride,
  templates: createTemplatesProvider(builtinTemplates, 'D:/data/.devzero/templates/custom'),
  // Task 11 B6 employees 域：builder + store（与 main 装配同形状，路径非契约）
  store: createEmployeeStore('D:/data/.devzero/employees', 'D:/data/.devzero/tmp'),
  builder: createEmployeeBuilder({
    provider: createTemplatesProvider(builtinTemplates, 'D:/data/.devzero/templates/custom'),
    store: createEmployeeStore('D:/data/.devzero/employees', 'D:/data/.devzero/tmp'),
    tmpRoot: 'D:/data/.devzero/tmp',
  }),
  // Task 12 C1 skills 域：zip 上传物化（tmpRoot 与 builder 同源）
  tmpRoot: 'D:/data/.devzero/tmp',
  service,
  engine,
  // I1 L2 安装线两域（值非契约——本文件只断言路由表，不触达端点行为）
  registryFile: 'D:/data/digital-staff/registry.json',
  staffRoot: 'D:/data/digital-staff',
  authSourceDirs: { 'claude-code': '', codebuddy: '', qoder: '' },
  probe: () => ({ present: false, version: null }),
  packageRoots: {},
  cacheDir: 'D:/data/.devzero/bases',
  run: async () => ({ code: 127, stdout: '' }),
}

/** 路由表投影：[method, path] 集合比较（注册顺序非契约——排序消除顺序敏感） */
function table(routes: Route[]): string[][] {
  return routes
    .map((r) => [r.method, r.path])
    .sort((a, b) => a.join(' ').localeCompare(b.join(' ')))
}

describe('路由汇总表（routes/index.ts registerAllRoutes）', () => {
  it('注册产物 = 期望路由表（I0-5 + session/auth/enrollment（A 系列） + engine 12（L3） + installs 5 / bases 3（I1 L2） + L1：templates 2 / employees 3 / skills 1）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/'],
      ['GET', '/api/activity'],
      ['GET', '/api/bases'],
      ['GET', '/api/bases/:id/models'],
      ['GET', '/api/config/platform'],
      ['GET', '/api/deployments'],
      ['GET', '/api/employees'],
      ['GET', '/api/employees/validate-id'],
      ['GET', '/api/engine/flows'],
      ['GET', '/api/engine/stream'],
      ['GET', '/api/engine/tasks'],
      ['GET', '/api/engine/tasks/:id'],
      ['GET', '/api/engine/tasks/:id/events'],
      ['GET', '/api/engine/tasks/:id/table'],
      ['GET', '/api/events'],
      ['GET', '/api/skills'],
      ['GET', '/api/state'],
      ['GET', '/api/templates'],
      ['GET', '/auth/callback'],
      ['GET', '/auth/login'],
      ['GET', '/healthz'],
      ['POST', '/api/bases/probe'],
      ['POST', '/api/deployments/execute'],
      ['POST', '/api/deployments/plan'],
      ['POST', '/api/deployments/verify'],
      ['POST', '/api/employees/generate'],
      ['POST', '/api/engine/tasks'],
      ['POST', '/api/engine/tasks/:id/abort'],
      ['POST', '/api/engine/tasks/:id/advance'],
      ['POST', '/api/engine/tasks/:id/complete'],
      ['POST', '/api/engine/tasks/:id/confirm-gate'],
      ['POST', '/api/engine/tasks/:id/dispatch-done'],
      ['POST', '/api/engine/tasks/:id/dispatch-start'],
      ['POST', '/api/engine/tasks/:id/handoff-write'],
      ['POST', '/api/engine/tasks/:id/record-gate'],
      ['POST', '/api/enroll'],
      ['POST', '/api/heartbeat'],
      ['POST', '/api/logout'],
      ['POST', '/api/progress'],
      ['POST', '/api/reset'],
      ['POST', '/api/skills/upload'],
      ['POST', '/api/uninstall'],
      ['PUT', '/api/config/platform'],
    ])
  })

  it('method+path 全唯一（分域注册不得产生重复路由）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    const keys = reg.routes.map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('重复注册（同 registry 二次汇总）→ 抛错（保险丝：注册期显式炸，不等请求期）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    expect(() => registerAllRoutes(reg, deps)).toThrow(/重复/)
  })
})

describe('分域注册（各域只注册自己的端点，域间无交叉）', () => {
  it('infra 域：/healthz、/api/events、/api/activity（不含 /）', () => {
    const reg = createRegistry()
    registerInfraRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/api/activity'],
      ['GET', '/api/events'],
      ['GET', '/healthz'],
    ])
  })

  it('shell 域：仅 /（不含 infra 端点）', () => {
    const reg = createRegistry()
    registerShellRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([['GET', '/']])
  })

  it('session 域：GET /api/state + POST /api/logout（A 系列真实会话端点；D-049 桥接退役，不含其他域端点）', () => {
    const reg = createRegistry()
    registerSessionRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([['GET', '/api/state'], ['POST', '/api/logout']])
  })

  it('config 域：GET+PUT /api/config/platform（I0-5 T8，不含其他域端点）', () => {
    const reg = createRegistry()
    registerConfigRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/api/config/platform'],
      ['PUT', '/api/config/platform'],
    ])
  })

  it('templates 域：GET /api/templates + GET /api/skills（Task 7 B2，不含其他域端点）', () => {
    const reg = createRegistry()
    registerTemplatesRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/api/skills'],
      ['GET', '/api/templates'],
    ])
  })

  it('employees 域：POST /api/employees/generate + GET /api/employees/validate-id + GET /api/employees（Task 11 B6 + Task 17 花名册，不含其他域端点）', () => {
    const reg = createRegistry()
    registerEmployeesRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/api/employees'],
      ['GET', '/api/employees/validate-id'],
      ['POST', '/api/employees/generate'],
    ])
  })
})

describe('Res/Ctx 契约类型扩展（认证迁移设计 §4.1）', () => {
  it('Res 新字段由类型承载（registry 类型同步，编译期契约）', () => {
    const res: Res = { status: 302, redirect: '/x', cookies: [{ name: 'a', value: 'b' }] }
    expect(res.redirect).toBe('/x')
  })
})

describe('鉴权档位声明（A-08，设计 §4.2）', () => {
  it('routes 记录 auth 档位（Route.auth 字段）', () => {
    const registry = createRegistry()
    registry.post('/api/x', () => ({ status: 200, json: {} }), { auth: 'session' })
    registry.get('/api/y', () => ({ status: 200, json: {} }))
    expect(registry.routes.find((r) => r.path === '/api/x')?.auth).toBe('session')
    expect(registry.routes.find((r) => r.path === '/api/y')?.auth).toBeUndefined()
  })
})
