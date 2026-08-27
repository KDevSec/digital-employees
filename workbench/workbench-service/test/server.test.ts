import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toHonoApp } from '../src/server/hono-adapter'
import { isLocalHost } from '../src/server/guard'
import { createRegistry } from '../src/server/registry'
import type { Ctx, Res } from '../src/server/registry'
import { registerAllRoutes } from '../src/server/routes'
import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig, writeConfigOverride } from '../src/config/load'
import { brand } from '../src/brand'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import { createEmployeeStore } from '../src/employees/store'
import { createEmployeeBuilder } from '../src/employees/builder'

import { Engine } from '@devzero/engine'
/** 编排域引擎夹具（L3 T6）：临时目录真实例——本文件断言不触达 engine 端点，行为在 routes-engine.test.ts */
const engineRoot = mkdtempSync(join(tmpdir(), 'server-engine-'))
process.on('exit', () => rmSync(engineRoot, { recursive: true, force: true }))

function buildApp(overrides: Partial<Parameters<typeof registerAllRoutes>[1]> = {}) {
  // Task 15 起全量装配含 A 系列三域：service 切片 + sessionGuard 注入（enrollment 全 session 档，
  // 无 guard 时 toHonoApp 装配保险丝即炸）；temp profile 供 platform-access 落 auth 密钥。
  const profileDir = mkdtempSync(join(tmpdir(), 'wb-server-'))
  const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: 'uid-abc', version: '9.9.9' })
  // L1 员工域三域占位实例（本文件不触达该域端点，行为断言在 routes-templates/-employees/-skills.test.ts）
  const store = createEmployeeStore('D:/data/.devzero/employees', 'D:/data/.devzero/tmp')
  const builder = createEmployeeBuilder({
    provider: createTemplatesProvider(builtinTemplates, 'D:/data/.devzero/templates/custom'),
    store,
    tmpRoot: 'D:/data/.devzero/tmp',
  })
  const registry = createRegistry()
  registerAllRoutes(registry, {
    version: '9.9.9',
    pid: 4321,
    uid: 'uid-abc',
    dataDir: 'D:/data/.devzero',
    uptime: () => 12_345,
    indexHtml: readEmbeddedIndexHtml(),
    // I0-5 T8 config 域：真实读写函数 + temp profile（本文件不触达该域端点，行为断言在 routes-config.test.ts）
    profileDir,
    loadConfig,
    writeConfigOverride,
    // Task 7 B2 templates 域：真实 builtin 资产 + 占位 customRoot（本文件不触达该域端点，行为断言在 routes-templates.test.ts）
    templates: createTemplatesProvider(builtinTemplates, 'D:/data/.devzero/templates/custom'),
    builder,
    store,
    // Task 12 C1 skills 域：tmpRoot 与 builder 同源（本文件不触达该域端点，行为断言在 routes-skills.test.ts）
    tmpRoot: 'D:/data/.devzero/tmp',
    engine: new Engine({ dataDir: join(engineRoot, 'data'), templatesDir: join(engineRoot, 'flows') }),
    // I1 L2 安装线两域：占位值（本文件不触达该两域端点，行为断言在 routes-installs/routes-bases.test.ts）
    registryFile: 'D:/data/digital-staff/registry.json',
    staffRoot: 'D:/data/digital-staff',
    authSourceDirs: { 'claude-code': '', codebuddy: '', qoder: '' },
    probe: () => ({ present: false, version: null }),
    packageRoots: {},
    employeesRoot: 'D:/data/.devzero/employees', // 终审 B1 回退根——本文件不触达 installs 端点，占位即可
    cacheDir: 'D:/data/.devzero/bases',
    run: async () => ({ code: 127, stdout: '' }),
    // A 系列认证三域（Task 15 起 service 切片 + guard 注入）
    service,
    ...overrides,
  })
  return toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })
}

/** 提交进仓的嵌入源（S-01）：测试直接消费真实产物，与 main 组装同源 */
function readEmbeddedIndexHtml(): string {
  return readFileSync('web-dist/index.html', 'utf8')
}

describe('route-registry + hono-adapter（框架无关路由表，hono 单点适配）', () => {
  it('GET /healthz → 200 JSON：app/status/version/pid/uid/uptime/dataDir（uid 必含——a540c56 契约裁决）', async () => {
    const app = buildApp()
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json).toEqual({
      app: 'workbench',
      status: 'ok',
      version: '9.9.9',
      pid: 4321,
      uid: 'uid-abc',
      uptime: 12_345,
      dataDir: 'D:/data/.devzero',
    })
  })

  it('健康响应 app 取自 brand 单源（不得由调用方注入篡改）', async () => {
    const app = buildApp()
    const json = (await (await app.request('/healthz')).json()) as { app: string }
    expect(json.app).toBe('workbench')
  })

  it('GET /api/events → 204 无 body（SSE 骨架占位，设计 §10.3）', async () => {
    const app = buildApp()
    const res = await app.request('/api/events')
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('GET /api/activity → {conversationTasks:0, triggerTasks:0}（硬值，D-8）', async () => {
    const app = buildApp()
    const res = await app.request('/api/activity')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversationTasks: 0, triggerTasks: 0 })
  })

  it('GET / → 200 text/html 且 body 含「研发零处数字员工终端」（S-01 嵌入 Web 壳，CLAUDE.md §4 命名）', async () => {
    const app = buildApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('研发零处数字员工终端')
  })

  it('GET / 的 Host 白名单守卫同样生效（evil.com → 403）', async () => {
    const app = buildApp()
    const res = await app.request('/', { headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
  })

  it('未注册路径 → 404', async () => {
    const app = buildApp()
    expect((await app.request('/nope')).status).toBe(404)
  })

  it('registry 直接持有路由表（routes 数组含 method/path/handler）', () => {
    const reg = createRegistry()
    reg.get('/a', () => ({ status: 200 }))
    reg.post('/b', () => ({ status: 201 }))
    expect(reg.routes.map((r) => [r.method, r.path])).toEqual([
      ['GET', '/a'],
      ['POST', '/b'],
    ])
  })
})

describe('Host 白名单（DNS rebinding 防护，设计 §10.1）', () => {
  it('Host: evil.com → 403（guard 拦截在 handler 之前）', async () => {
    const app = buildApp()
    const res = await app.request('/healthz', { headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
  })

  it('Host: localhost:19980 与 127.0.0.1:19980 → 放行', async () => {
    const app = buildApp()
    for (const host of ['localhost:19980', '127.0.0.1:19980']) {
      const res = await app.request('/healthz', { headers: { Host: host } })
      expect(res.status).toBe(200)
    }
  })

  it('无端口的 localhost / 127.0.0.1 → 放行', async () => {
    const app = buildApp()
    for (const host of ['localhost', '127.0.0.1']) {
      const res = await app.request('/healthz', { headers: { Host: host } })
      expect(res.status).toBe(200)
    }
  })

  it('isLocalHost 纯函数表驱动', () => {
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('localhost:19980')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('127.0.0.1:19980')).toBe(true)
    expect(isLocalHost('LOCALHOST:19980')).toBe(true)
    expect(isLocalHost('[::1]:19980')).toBe(false)
    expect(isLocalHost('evil.com')).toBe(false)
    expect(isLocalHost('evil.com:19980')).toBe(false)
    expect(isLocalHost('sub.localhost')).toBe(false)
    expect(isLocalHost('127.0.0.2')).toBe(false)
    expect(isLocalHost('')).toBe(false)
  })
})

describe('架构纪律：hono 只出现在 hono-adapter.ts', () => {
  it('registry/routes 各域文件/guard 均无 hono import（grep -L 语义，fs 实现以跨平台）', async () => {
    // routes/ 目录整目录扫描——I1 各线新增域文件自动纳入纪律覆盖，不依赖清单手工维护
    const files = [
      'src/server/registry.ts',
      ...readdirSync('src/server/routes').filter((f) => f.endsWith('.ts')).map((f) => `src/server/routes/${f}`),
      'src/server/guard.ts',
    ]
    const honoImport = /from\s+['"]hono|require\(['"]hono|import\s+['"]hono/
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(honoImport.test(src), `${f} 不得 import hono`).toBe(false)
    }
    const adapter = readFileSync('src/server/hono-adapter.ts', 'utf8')
    expect(adapter.includes("from 'hono'")).toBe(true)
  })

  it('registry 的 Ctx/Res 类型是框架无关形状（编译期即约束，此处冒烟消费）', async () => {
    const reg = createRegistry()
    let seen: { method: string; path: string; host: string } | undefined
    reg.get('/echo', (ctx) => {
      seen = { method: ctx.method, path: ctx.path, host: ctx.host }
      return { status: 200, json: { ok: true } }
    })
    const app = toHonoApp(reg)
    const res = await app.request('/echo', { headers: { Host: 'localhost:19980' } })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ method: 'GET', path: '/echo', host: 'localhost:19980' })
  })
})

describe('数据目录与日志目录布局（healthz.dataDir 报 profile 真实路径）', () => {
  it('dataDir 透传注入值（真实值由 main 组装传入）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-ep-'))
    const app = buildApp({ dataDir: dir })
    const json = (await (await app.request('/healthz')).json()) as { dataDir: string }
    expect(json.dataDir).toBe(dir)
    expect(existsSync(json.dataDir)).toBe(true)
  })
})

describe('嵌入源 web-dist/index.html（提交进仓的编译期资产，S-01）', () => {
  it('为单文件形态：含中文正式名、无外链 script、无外链 stylesheet', () => {
    const html = readEmbeddedIndexHtml()
    expect(html).toContain('研发零处数字员工终端')
    expect(html).not.toMatch(/<script\s+src=/)
    expect(html).not.toMatch(/<link\s+rel="stylesheet"\s+href=/)
  })

  it('品牌镜像防漂移：web 包的 APP_ID/标题镜像与 service brand 单源一致（品牌 sweep 漏改时此处红）', () => {
    const html = readEmbeddedIndexHtml()
    // web 包 src/api/health.ts 的 APP_ID 镜像（interpretHealth 判自家 app 的字面量）
    expect(html).toContain(brand.app)
    // web 包品牌正式名镜像（CLAUDE.md §4——中文正式名，DevZero 不作正式名称出现）
    expect(html).toContain(brand.displayNameZh)
  })
})

describe('Res/Ctx 契约扩展（认证迁移设计 §4.1）', () => {
  function buildAppWith(handler: (ctx: Ctx) => Res | Promise<Res>): ReturnType<typeof toHonoApp> {
    const registry = createRegistry()
    registry.get('/probe', handler)
    return toHonoApp(registry)
  }

  it('redirect：302 + Location 头 + 空 body', async () => {
    const app = buildAppWith(() => ({ status: 302, redirect: 'https://idp.example/auth?x=1' }))
    const res = await app.request('/probe')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://idp.example/auth?x=1')
    expect(await res.text()).toBe('')
  })

  it('cookies：逐条 append Set-Cookie（HttpOnly/SameSite/Max-Age/Path 序列化）', async () => {
    const app = buildAppWith(() => ({
      status: 200,
      json: { ok: true },
      cookies: [
        { name: 'workbench_session', value: 'sid-123', maxAgeSeconds: 300, httpOnly: true, sameSite: 'Strict' },
        { name: 'cleared', value: '', maxAgeSeconds: 0 },
      ],
    }))
    const res = await app.request('/probe')
    const cookies = res.headers.getSetCookie()
    expect(cookies).toContain('workbench_session=sid-123; Max-Age=300; HttpOnly; SameSite=Strict; Path=/')
    expect(cookies).toContain('cleared=; Max-Age=0; Path=/')
  })

  it('Ctx.cookies：Cookie 头解析（demo cookies() 语义迁移）', async () => {
    let seen: Record<string, string> | undefined
    const app = buildAppWith((ctx) => {
      seen = ctx.cookies
      return { status: 204 }
    })
    await app.request('/probe', { headers: { Cookie: 'workbench_session=sid-123; other=value%20x' } })
    expect(seen).toEqual({ workbench_session: 'sid-123', other: 'value x' })
  })

  it('Ctx.query：查询串解析（URLSearchParams，/auth/callback 消费 code/state——L3 合流后类型统一）', async () => {
    let seen: URLSearchParams | undefined
    const app = buildAppWith((ctx) => {
      seen = ctx.query
      return { status: 204 }
    })
    await app.request('/probe?code=abc&state=xyz')
    expect(seen?.get('code')).toBe('abc')
    expect(seen?.get('state')).toBe('xyz')
  })

  it('redirect 与 json 并存时 redirect 胜出（互斥约定：登录链 handler 只给 redirect）', async () => {
    const app = buildAppWith(() => ({ status: 302, redirect: '/', json: { stale: true } }))
    const res = await app.request('/probe')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
    expect(res.headers.get('content-type')).toBeNull()
  })

  it('畸形 Cookie 头（裸 %）不炸路由：畸形对跳过、合法对仍解析', async () => {
    let seen: Record<string, string> | undefined
    const app = buildAppWith((ctx) => { seen = ctx.cookies; return { status: 204 } })
    const res = await app.request('/probe', { headers: { Cookie: 'bad=50%; good=sid-123' } })
    expect(res.status).toBe(204)
    expect(seen).toEqual({ good: 'sid-123' })
  })

  it('恶意 Host + 畸形 Cookie → 仍 403（S-12 Host 守卫优先级不被 cookie 解析破坏）', async () => {
    const app = buildAppWith(() => ({ status: 200, json: { ok: true } }))
    const res = await app.request('/probe', { headers: { Host: 'evil.com', Cookie: 'x=50%' } })
    expect(res.status).toBe(403)
  })
})

describe('鉴权档位（A-08，设计 §4.2）', () => {
  it('档位路由 + guard 拒绝 → 短路返回 guard 的 Res（handler 不执行）', async () => {
    const registry = createRegistry()
    let handlerReached = false
    registry.post('/api/business', () => {
      handlerReached = true
      return { status: 200, json: { ok: true } }
    }, { auth: 'session' })
    const app = toHonoApp(registry, {
      sessionGuard: async () => ({ status: 401, json: { error: { code: 'PERSON_SESSION_INVALID', message: '请先使用企业账号登录' } } }),
    })
    const res = await app.request('/api/business', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PERSON_SESSION_INVALID')
    expect(handlerReached).toBe(false)
  })

  it('guard 放行（null）→ handler 执行，grade 透传（session-active 档）', async () => {
    const registry = createRegistry()
    const grades: string[] = []
    registry.post('/api/business', () => ({ status: 200, json: { ok: true } }), { auth: 'session-active' })
    const app = toHonoApp(registry, {
      sessionGuard: async (_ctx, grade) => {
        grades.push(grade)
        return null
      },
    })
    const res = await app.request('/api/business', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(grades).toEqual(['session-active'])
  })

  it('Host 守卫仍先于鉴权（S-12 不松动）：恶意 Host → 403 且 guard 不执行', async () => {
    const registry = createRegistry()
    registry.post('/api/business', () => ({ status: 200, json: {} }), { auth: 'session' })
    let guardRan = false
    const app = toHonoApp(registry, {
      sessionGuard: async () => {
        guardRan = true
        return null
      },
    })
    const res = await app.request('/api/business', { method: 'POST', headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
    expect(guardRan).toBe(false)
  })

  it('装配保险丝：有 auth 档路由但未注入 guard → toHonoApp 构造期抛错', () => {
    const registry = createRegistry()
    registry.post('/api/business', () => ({ status: 200, json: {} }), { auth: 'session' })
    expect(() => toHonoApp(registry)).toThrow(/sessionGuard/)
  })

  it('无档位路由不受 guard 影响（/healthz、auth 端点等不设防）', async () => {
    const registry = createRegistry()
    registry.get('/healthz', () => ({ status: 200, json: { ok: true } }))
    const app = toHonoApp(registry, {
      sessionGuard: async () => ({ status: 401, json: { error: { code: 'X', message: 'x' } } }),
    })
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
  })
})
