import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig } from '../src/config/load'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerEnrollmentRoutes } from '../src/server/routes/enrollment'

let profileDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-enroll-routes-'))
})

function buildApp() {
  const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: '11112222-3333', version: '0.0.1' })
  const registry = createRegistry()
  registerEnrollmentRoutes(registry, { service })
  return toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })
}

describe('分域注册（routes/enrollment.ts：四端点全 session 档）', () => {
  it('路由表 = POST × 4 全 session 档', () => {
    const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: 'i', version: '0' })
    const reg = createRegistry()
    registerEnrollmentRoutes(reg, { service })
    expect(reg.routes.map((r) => [r.method, r.path, r.auth])).toEqual([
      ['POST', '/api/enroll', 'session'],
      ['POST', '/api/progress', 'session'],
      ['POST', '/api/reset', 'session'],
      ['POST', '/api/heartbeat', 'session'],
    ])
  })
})

describe('四端点两态', () => {
  it('开发环境 → 503 PLATFORM_NOT_CONFIGURED（guard 放行后 handler 明确报错）', async () => {
    const app = buildApp()
    for (const path of ['/api/enroll', '/api/progress', '/api/reset', '/api/heartbeat']) {
      const res = await app.request(path, { method: 'POST' })
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PLATFORM_NOT_CONFIGURED')
    }
  })

  it('生产语义未登录 → 401（A-08 档位生效，D-031）', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    const app = buildApp()
    for (const path of ['/api/enroll', '/api/progress', '/api/reset', '/api/heartbeat']) {
      const res = await app.request(path, { method: 'POST' })
      expect(res.status).toBe(401)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PERSON_SESSION_INVALID')
    }
  })

  it('生产语义已登录 → 过 guard 进 handler（enroll 打到平台，mock fetch）', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://p:18000' } }), 'utf8')
    const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: '11112222-3333', version: '0.0.1' })
    // 直写会话
    const { SessionStore } = await import('../src/app/platform-access/session-store')
    const { loadOrCreateAuthSecret } = await import('../src/app/platform-access/auth-secret')
    const secret = loadOrCreateAuthSecret(join(profileDir, 'auth'))
    const store = new SessionStore(join(profileDir, 'auth', 'sessions.enc'), secret)
    await store.set('sid-1', { accessToken: 'person-token', claims: {}, expiresAt: Date.now() + 60_000 })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'enr-1', status: 'PENDING_REVIEW' }), { status: 200 })) as unknown as typeof fetch)
    const registry = createRegistry()
    registerEnrollmentRoutes(registry, { service })
    const app = toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })
    const res = await app.request('/api/enroll', { method: 'POST', headers: { Cookie: 'workbench_session=sid-1' } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id?: string }).id).toBe('enr-1')
    vi.unstubAllGlobals()
  })
})
