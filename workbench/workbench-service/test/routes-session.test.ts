import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig } from '../src/config/load'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerSessionRoutes } from '../src/server/routes/session'

/**
 * session 域（D-049 桥接退役后的真实会话端点）：
 * - 开发环境：真 installationId（D-am4）+ ACTIVE + authenticated（D-049 语义不回归）
 * - 生产语义：未登录 200 + authenticated:false（D-am3——桥接期的 401 已退役）
 * - /api/logout：清 cookie
 */

let profileDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-session-routes-'))
})

function buildApp() {
  const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: '11112222-3333', version: '0.0.1' })
  const registry = createRegistry()
  registerSessionRoutes(registry, { service })
  return toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })
}

describe('分域注册（routes/session.ts）', () => {
  it('session 域路由表 = GET /api/state + POST /api/logout', () => {
    const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: 'i', version: '0' })
    const reg = createRegistry()
    registerSessionRoutes(reg, { service })
    expect(reg.routes.map((r) => [r.method, r.path])).toEqual([['GET', '/api/state'], ['POST', '/api/logout']])
  })
})

describe('GET /api/state', () => {
  it('开发环境（默认无配置）→ 200 开发态：真 installationId（D-am4）+ ACTIVE + 开发用户', async () => {
    const res = await buildApp().request('/api/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      installationId: '11112222-3333',
      status: 'ACTIVE',
      authenticated: true,
      user: { name: '开发模式', preferred_username: 'dev', email: 'dev@localhost' },
    })
  })

  it('已配置平台（生产语义）未登录 → 200 + authenticated:false（D-am3 桥接退役；状态卡仍可渲染）', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    const res = await buildApp().request('/api/state')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { installationId: string; status: string; authenticated: boolean; user?: unknown }
    expect(json.installationId).toBe('11112222-3333')
    expect(json.status).toBe('NEW')
    expect(json.authenticated).toBe(false)
    expect(json.user).toBeUndefined()
  })

  it('Host 白名单守卫照常（S-12 不因开发环境松动）', async () => {
    const res = await buildApp().request('/api/state', { headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/logout', () => {
  it('清 cookie + logged_out（匿名也 200，偏差 #3）', async () => {
    const res = await buildApp().request('/api/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json() as { status: string }).status).toBe('logged_out')
    expect(res.headers.getSetCookie().some((c) => c.startsWith('workbench_session=; Max-Age=0'))).toBe(true)
  })
})
