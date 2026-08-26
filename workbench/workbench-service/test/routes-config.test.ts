import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, writeConfigOverride } from '../src/config/load'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerConfigRoutes } from '../src/server/routes/config'

/**
 * config 域路由（I0-5 T8，设计 D-13~D-18 方案 A）：GET/PUT /api/config/platform。
 * - 真实文件 IO（temp profile 目录）——「PUT 写入 config.json」是契约本体（D-13），不做函数桩；
 * - 错误响应形状 { error: { code, message } }：沿 demo PlatformError 错误处理器形状
 *   （web 侧 api/access.ts postAction 按 error.message 消费同款形状，前端免适配）——测试注明；
 * - Host 白名单守卫在 hono-adapter 层先于 handler（S-12），本域照常生效。
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz 同档无鉴权；本机边界 = 仅绑 127.0.0.1 + Host 白名单。
 */

let profileDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-cfg-routes-'))
})

/** 域装配：只挂 config 域（域行为聚焦；全量汇总表断言在 routes-registry.test.ts） */
function buildApp(): ReturnType<typeof toHonoApp> {
  const registry = createRegistry()
  registerConfigRoutes(registry, { profileDir, loadConfig, writeConfigOverride })
  return toHonoApp(registry)
}

/** PUT 便捷入口（默认 JSON body；headers 可注入 Host 等） */
async function put(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await buildApp().request('/api/config/platform', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('分域注册（routes/config.ts 只注册本域端点，设计 D-14）', () => {
  it('config 域路由表 = GET+PUT /api/config/platform，无其他端点', () => {
    const reg = createRegistry()
    registerConfigRoutes(reg, { profileDir, loadConfig, writeConfigOverride })
    expect(reg.routes.map((r) => [r.method, r.path])).toEqual([
      ['GET', '/api/config/platform'],
      ['PUT', '/api/config/platform'],
    ])
  })
})

describe('GET /api/config/platform', () => {
  it('profile 无 config.json → 返回代码默认 http://127.0.0.1:18000', async () => {
    const res = await buildApp().request('/api/config/platform')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ baseUrl: 'http://127.0.0.1:18000' })
  })

  it('config.json 已带 platform.baseUrl → 返回当前值', async () => {
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }),
      'utf8',
    )
    const res = await buildApp().request('/api/config/platform')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ baseUrl: 'http://192.168.1.5:18000' })
  })
})

describe('PUT /api/config/platform', () => {
  it('合法 http URL → 200 回显新值；写入 config.json；后续 GET 立即反映（D-14：GET 每次重读文件）', async () => {
    const res = await put({ baseUrl: 'http://10.1.2.3:18000' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ baseUrl: 'http://10.1.2.3:18000' })

    // 写入文件（D-13：只落覆盖键——首写即全量覆盖键）
    const onDisk = JSON.parse(readFileSync(join(profileDir, 'config.json'), 'utf8'))
    expect(onDisk).toEqual({ platform: { baseUrl: 'http://10.1.2.3:18000' } })

    // 后续 GET 立即可见（handler 不缓存，每次 loadConfig 重读）
    const after = await buildApp().request('/api/config/platform')
    expect(await after.json()).toEqual({ baseUrl: 'http://10.1.2.3:18000' })
  })

  it('合法 https URL 同样收（http/https 均过，D-14）', async () => {
    const res = await put({ baseUrl: 'https://platform.corp.example.com' })
    expect(res.status).toBe(200)
    expect(loadConfig(profileDir).platform.baseUrl).toBe('https://platform.corp.example.com')
  })

  it.each([
    ['空串', ''],
    ['非 URL', 'not-a-url'],
    ['缺 scheme', '192.168.1.5:18000'],
    ['非 http(s) scheme（zod url() 收任意 scheme，http(s) 限定由 refine 收口）', 'ftp://files.example.com'],
  ])('非法 baseUrl（%s）→ 400 + {error:{code,message}}（PlatformError 风格形状，测试注明）', async (_label, baseUrl) => {
    const res = await put({ baseUrl })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { code: string; message: string } }
    expect(json.error.code).toBe('INVALID_PLATFORM_URL')
    expect(json.error.message.length).toBeGreaterThan(0)
    // 非法输入不落盘
    expect(existsSync(join(profileDir, 'config.json'))).toBe(false)
  })

  it('body 缺失 / 非 JSON / 缺 baseUrl / 值类型错 / 多余键 → 400（strict zod 校验）', async () => {
    // 无 body（Content-Type 给出但 body 缺失，adapter 归一 undefined）
    const noBody = await buildApp().request('/api/config/platform', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(noBody.status).toBe(400)

    for (const body of [{}, { baseUrl: 123 }, { baseUrl: 'http://ok.example', extra: 1 }]) {
      const res = await put(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(existsSync(join(profileDir, 'config.json'))).toBe(false)
  })

  it('既有其他键（network.port / _comment）不被覆盖（D-13：写入只落覆盖键、保留既有键）', async () => {
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({ _comment: '手工注释', network: { port: 1234 } }),
      'utf8',
    )
    const res = await put({ baseUrl: 'http://10.9.8.7:18000' })
    expect(res.status).toBe(200)

    const onDisk = JSON.parse(readFileSync(join(profileDir, 'config.json'), 'utf8'))
    expect(onDisk).toEqual({
      _comment: '手工注释',
      network: { port: 1234 },
      platform: { baseUrl: 'http://10.9.8.7:18000' },
    })
    // 合并产物整体仍可通过 schema 校验（既有键未被破坏）
    expect(loadConfig(profileDir)).toEqual({
      network: { port: 1234 },
      platform: { baseUrl: 'http://10.9.8.7:18000' },
    })
  })

  it('Host 白名单守卫照常：PUT 带 Host: evil.com → 403 且不写文件（守卫先于 handler，S-12）', async () => {
    const res = await put({ baseUrl: 'http://10.1.1.1:18000' }, { Host: 'evil.com' })
    expect(res.status).toBe(403)
    expect(existsSync(join(profileDir, 'config.json'))).toBe(false)
  })
})
