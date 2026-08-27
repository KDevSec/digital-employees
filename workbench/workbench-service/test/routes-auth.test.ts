import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig } from '../src/config/load'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerAuthRoutes } from '../src/server/routes/auth'

let profileDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-auth-routes-'))
})

function buildApp() {
  const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: '11112222-3333', version: '0.0.1' })
  const registry = createRegistry()
  registerAuthRoutes(registry, { service })
  return toHonoApp(registry)
}

describe('分域注册（routes/auth.ts）', () => {
  it('auth 域路由表 = GET /auth/login + GET /auth/callback（均无档位——auth 端点本身不设防）', () => {
    const { service } = createPlatformAccess({ profileDir, loadConfig, installationId: 'i', version: '0' })
    const reg = createRegistry()
    registerAuthRoutes(reg, { service })
    expect(reg.routes.map((r) => [r.method, r.path, r.auth ?? null])).toEqual([
      ['GET', '/auth/login', null],
      ['GET', '/auth/callback', null],
    ])
  })
})

describe('GET /auth/login', () => {
  it('开发环境 → 503 PLATFORM_NOT_CONFIGURED（{error:{code,message}} 形状）', async () => {
    const res = await buildApp().request('/auth/login')
    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: { code: string; message: string } }
    expect(json.error.code).toBe('PLATFORM_NOT_CONFIGURED')
    expect(json.error.message).toContain('未配置平台地址')
  })

  it('生产语义平台不可达（无缓存）→ 503 PLATFORM_UNREACHABLE', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    // 实施注记（偏离 brief 一行）：真机对 192.168.1.5:18000 的 TCP 连接超时约 21s（SYN 黑洞），
    // 超过 vitest 默认 5s 测试超时——按 access-service.test.ts 同场景既有约定 stub fetch 抛错（本域测试聚焦接线性状）。
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    const res = await buildApp().request('/auth/login')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PLATFORM_UNREACHABLE')
    vi.unstubAllGlobals()
  })
})

describe('GET /auth/callback', () => {
  it('流程无效 → 401 PERSON_SESSION_INVALID（query 消费：code/state）', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    const res = await buildApp().request('/auth/callback?code=x&state=invalid')
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PERSON_SESSION_INVALID')
  })
})
