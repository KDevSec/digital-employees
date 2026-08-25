import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toHonoApp } from '../src/server/hono-adapter'
import { isLocalHost } from '../src/server/guard'
import { createRegistry } from '../src/server/registry'
import { registerEndpoints } from '../src/server/endpoints'
import { brand } from '../src/brand'

function buildApp(overrides: Partial<Parameters<typeof registerEndpoints>[1]> = {}) {
  const registry = createRegistry()
  registerEndpoints(registry, {
    version: '9.9.9',
    pid: 4321,
    uid: 'uid-abc',
    dataDir: 'D:/data/.devzero',
    uptime: () => 12_345,
    indexHtml: readEmbeddedIndexHtml(),
    ...overrides,
  })
  return toHonoApp(registry)
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

  it('GET / → 200 text/html 且 body 含「DevZero」（S-01 嵌入 Web 壳）', async () => {
    const app = buildApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('DevZero')
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
  it('registry/endpoints/guard 三文件均无 hono import（grep -L 语义，fs 实现以跨平台）', async () => {
    const files = ['src/server/registry.ts', 'src/server/endpoints.ts', 'src/server/guard.ts']
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
  it('为单文件形态：含「DevZero」、无外链 script、无外链 stylesheet', () => {
    const html = readEmbeddedIndexHtml()
    expect(html).toContain('DevZero')
    expect(html).not.toMatch(/<script\s+src=/)
    expect(html).not.toMatch(/<link\s+rel="stylesheet"\s+href=/)
  })

  it('品牌镜像防漂移：web 包的 APP_ID/标题镜像与 service brand 单源一致（品牌 sweep 漏改时此处红）', () => {
    const html = readEmbeddedIndexHtml()
    // web 包 src/api/health.ts 的 APP_ID 镜像（interpretHealth 判自家 app 的字面量）
    expect(html).toContain(brand.app)
    // web 包 Home.vue 的标题镜像（文案写死，见计划 Task 10）
    expect(html).toContain(brand.displayName)
  })
})
