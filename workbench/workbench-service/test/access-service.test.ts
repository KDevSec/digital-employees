import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPlatformAccess } from '../src/app/platform-access'
import { loadConfig } from '../src/config/load'

/**
 * PlatformAccessService 集成套件（Task 14 门面）：走 createPlatformAccess 真装配
 * （auth-secret→stores→platform→config-cache→flows→machineTokens→enrollment），
 * 覆盖八端点 + sessionGuard + 错误归一。mock 只 stub 全局 fetch 按 URL 路由
 * （well-known 配置 / openid-configuration / jwks / token / enrollment）。
 * 开发环境语义 = D-049 同一判据（platform.baseUrl 空串）。
 */

const CONFIG = {
  platform_base_url: 'http://p:18000',
  oidc_issuer: 'http://p:18000/oauth2/workbench',
  oidc_client_id: 'workbench-desktop',
  enrollment_endpoint: 'http://p:18000/api/v1/workbench-enrollments',
  machine_token_endpoint: 'http://p:18000/oauth2/workbench/token',
  protocol_version: 'v1',
}

afterEach(() => vi.unstubAllGlobals())

function tempProfile(platformBaseUrl?: string) {
  const profileDir = mkdtempSync(join(tmpdir(), 'wb-access-'))
  if (platformBaseUrl !== undefined) {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: platformBaseUrl } }), 'utf8')
  }
  return profileDir
}

function serviceFor(profileDir: string) {
  return createPlatformAccess({ profileDir, loadConfig, installationId: '11112222-3333', version: '0.0.1' }).service
}

const HOST_CTX = { method: 'GET' as const, path: '/auth/login', host: '127.0.0.1:19990' }

describe('PlatformAccessService——开发环境（D-049 衔接，设计 §4.4）', () => {
  it('/api/state：真 installationId（D-am4）+ ACTIVE + authenticated + 开发用户', async () => {
    const service = serviceFor(tempProfile())
    const res = await service.state({ ...HOST_CTX, path: '/api/state' })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({
      installationId: '11112222-3333',
      status: 'ACTIVE',
      authenticated: true,
      user: { name: '开发模式', preferred_username: 'dev', email: 'dev@localhost' },
    })
  })

  it('/auth/login：503 PLATFORM_NOT_CONFIGURED（不空转，五问 #4）', async () => {
    const service = serviceFor(tempProfile())
    const res = await service.login(HOST_CTX)
    expect(res.status).toBe(503)
    expect((res.json as { error: { code: string } }).error.code).toBe('PLATFORM_NOT_CONFIGURED')
  })

  it('动作端点（enroll/progress/heartbeat/reset）：开发态一律 503 PLATFORM_NOT_CONFIGURED', async () => {
    const service = serviceFor(tempProfile())
    const ctx = { ...HOST_CTX, method: 'POST' as const, path: '/api/enroll' }
    for (const res of [await service.enroll(ctx), await service.progress(ctx), await service.heartbeat(ctx), await service.reset(ctx)]) {
      expect(res.status).toBe(503)
      expect((res.json as { error: { code: string } }).error.code).toBe('PLATFORM_NOT_CONFIGURED')
    }
  })

  it('sessionGuard：开发环境全放行（null）', async () => {
    const service = serviceFor(tempProfile())
    expect(await service.sessionGuard(HOST_CTX, 'session')).toBeNull()
    expect(await service.sessionGuard(HOST_CTX, 'session-active')).toBeNull()
  })
})

describe('PlatformAccessService——生产语义', () => {
  it('/api/state 未登录：200 + authenticated:false（D-am3 桥接退役）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    const service = serviceFor(tempProfile('http://p:18000'))
    const res = await service.state({ ...HOST_CTX, path: '/api/state' })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ installationId: '11112222-3333', status: 'NEW', authenticated: false })
    expect((res.json as { user?: unknown }).user).toBeUndefined()
  })

  it('/auth/login 平台不可达且无缓存：503 PLATFORM_UNREACHABLE；discover 成功：302 带 PKCE 参数', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    const service = serviceFor(tempProfile('http://p:18000'))
    const denied = await service.login(HOST_CTX)
    expect(denied.status).toBe(503)
    expect((denied.json as { error: { code: string } }).error.code).toBe('PLATFORM_UNREACHABLE')

    // 平台恢复（discover + discovery 文档）
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'http://p:18000/.well-known/workbench-configuration') {
        return new Response(JSON.stringify(CONFIG), { status: 200 })
      }
      return new Response(JSON.stringify({
        issuer: CONFIG.oidc_issuer,
        authorization_endpoint: 'http://p:18000/oauth2/auth',
        token_endpoint: 'http://p:18000/oauth2/token',
        jwks_uri: 'http://p:18000/oauth2/certs',
      }), { status: 200 })
    }) as unknown as typeof fetch)
    const res = await service.login(HOST_CTX)
    expect(res.status).toBe(302)
    const location = res.redirect ?? ''
    expect(location).toContain('http://p:18000/oauth2/auth?')
    expect(location).toContain('code_challenge_method=S256')
    expect(location).toContain('client_id=workbench-desktop')
    expect(location).toContain('redirect_uri=' + encodeURIComponent('http://127.0.0.1:19990/auth/callback'))
  })

  it('发现缓存回退：discover 失败但缓存来源匹配 → 用缓存继续 302；来源不匹配 → 503', async () => {
    const profileDir = tempProfile('http://p:18000')
    // 第一轮 discover 成功写缓存
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'http://p:18000/.well-known/workbench-configuration') {
        return new Response(JSON.stringify(CONFIG), { status: 200 })
      }
      return new Response(JSON.stringify({ issuer: CONFIG.oidc_issuer, authorization_endpoint: 'http://p:18000/oauth2/auth' }), { status: 200 })
    }) as unknown as typeof fetch)
    const service = serviceFor(profileDir)
    expect((await service.login(HOST_CTX)).status).toBe(302)

    // 平台挂了：discover 失败 → 回退缓存
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'http://p:18000/.well-known/workbench-configuration') throw new TypeError('down')
      return new Response(JSON.stringify({ issuer: CONFIG.oidc_issuer, authorization_endpoint: 'http://p:18000/oauth2/auth' }), { status: 200 })
    }) as unknown as typeof fetch)
    expect((await service.login(HOST_CTX)).status).toBe(302) // 缓存回退成功

    // 平台地址已换 → 缓存来源不匹配 → 503
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://new:18000' } }), 'utf8')
    const denied = await service.login(HOST_CTX)
    expect(denied.status).toBe(503)
  })

  it('/auth/callback 全链：建会话 Set-Cookie + 302 / + 自动提交申请', async () => {
    const profileDir = tempProfile('http://p:18000')
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const privateJwk = await exportJWK(privateKey)
    const publicJwk = await exportJWK(publicKey)

    const service = serviceFor(profileDir)
    // 1. login 拿 flow（mock 平台 + IdP discovery）
    let currentNonce = ''
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://p:18000/.well-known/workbench-configuration') return new Response(JSON.stringify(CONFIG), { status: 200 })
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({
          issuer: CONFIG.oidc_issuer,
          authorization_endpoint: 'http://p:18000/oauth2/auth',
          token_endpoint: 'http://p:18000/oauth2/token',
          jwks_uri: 'http://p:18000/oauth2/certs',
        }), { status: 200 })
      }
      if (url === 'http://p:18000/oauth2/certs') return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
      if (url === 'http://p:18000/oauth2/token') {
        const body = new URLSearchParams(String(init?.body))
        const verifier = body.get('code_verifier') ?? ''
        // 用 verifier 侧拿不到 nonce——nonce 由 login 阶段生成；此处直接签发（测试内经 flow store 读取已不可能，
        // 故由测试先 login 抓 Location 里的 nonce）
        const idToken = await new SignJWT({ nonce: currentNonce, email: 'user@example.com' })
          .setProtectedHeader({ alg: 'ES256' })
          .setIssuer(CONFIG.oidc_issuer)
          .setAudience(CONFIG.oidc_client_id)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(await importJWK(privateJwk, 'ES256'))
        return new Response(JSON.stringify({ access_token: 'person-token', id_token: idToken, expires_in: 300 }), { status: 200 })
      }
      if (url === 'http://p:18000/api/v1/workbench-enrollments') {
        return new Response(JSON.stringify({ id: 'enr-1', status: 'PENDING_REVIEW' }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as unknown as typeof fetch)

    const loginRes = await service.login(HOST_CTX)
    const location = loginRes.redirect ?? ''
    const params = new URL(location).searchParams
    currentNonce = params.get('nonce') ?? ''
    const stateParam = params.get('state') ?? ''

    const callbackRes = await service.callback({ ...HOST_CTX, path: '/auth/callback', query: { code: 'auth-code', state: stateParam } })
    expect(callbackRes.status).toBe(302)
    expect(callbackRes.redirect).toBe('/')
    const cookie = callbackRes.cookies?.[0]
    expect(cookie).toMatchObject({ name: 'workbench_session', httpOnly: true, sameSite: 'Strict', maxAgeSeconds: 300 })
    expect(cookie?.value).toBeTruthy()

    // 2. 建立的会话可被 guard 认可 + /api/state 认证态 + 自动提交已发生
    const cookieCtx = { ...HOST_CTX, path: '/api/state', cookies: { workbench_session: cookie!.value } }
    expect(await service.sessionGuard(cookieCtx, 'session')).toBeNull()
    const stateRes = await service.state(cookieCtx)
    expect((stateRes.json as { authenticated: boolean; status: string }).authenticated).toBe(true)
    expect((stateRes.json as { status: string }).status).toBe('PENDING_REVIEW')
    expect((stateRes.json as { user?: { email?: string } }).user?.email).toBe('user@example.com')
  })

  it('callback 流程无效（state 不存在）→ 401', async () => {
    const service = serviceFor(tempProfile('http://p:18000'))
    const res = await service.callback({ ...HOST_CTX, path: '/auth/callback', query: { code: 'x', state: 'nope' } })
    expect(res.status).toBe(401)
    expect((res.json as { error: { code: string } }).error.code).toBe('PERSON_SESSION_INVALID')
  })

  it('sessionGuard：生产无会话 401；有会话 session 档放行；session-active 档非 ACTIVE → 403', async () => {
    const profileDir = tempProfile('http://p:18000')
    const service = serviceFor(profileDir)
    const denied = await service.sessionGuard(HOST_CTX, 'session')
    expect(denied?.status).toBe(401)
    expect((denied?.json as { error: { code: string } }).error.code).toBe('PERSON_SESSION_INVALID')

    // 直接注入一个有效会话（经 SessionStore）
    const { SessionStore } = await import('../src/app/platform-access/session-store')
    const { loadOrCreateAuthSecret } = await import('../src/app/platform-access/auth-secret')
    const store = new SessionStore(join(profileDir, 'auth', 'sessions.enc'), loadOrCreateAuthSecret(join(profileDir, 'auth')))
    await store.set('sid-ok', { accessToken: 't', claims: {}, expiresAt: Date.now() + 60_000 })
    const okCtx = { ...HOST_CTX, cookies: { workbench_session: 'sid-ok' } }
    expect(await service.sessionGuard(okCtx, 'session')).toBeNull()
    const active = await service.sessionGuard(okCtx, 'session-active')
    expect(active?.status).toBe(403)
    expect((active?.json as { error: { code: string } }).error.code).toBe('ENROLLMENT_NOT_ACTIVE')
  })

  it('logout：清 cookie + 200（匿名调用也 200，偏差 #3）', async () => {
    const service = serviceFor(tempProfile('http://p:18000'))
    const res = await service.logout({ ...HOST_CTX, method: 'POST' as const, path: '/api/logout', cookies: { workbench_session: 'sid-x' } })
    expect(res.status).toBe(200)
    expect((res.json as { status: string }).status).toBe('logged_out')
    expect(res.cookies?.[0]).toMatchObject({ name: 'workbench_session', maxAgeSeconds: 0 })
  })

  it('非 PlatformError 异常 → 500 WORKBENCH_ERROR（错误归一）', async () => {
    const service = serviceFor(tempProfile('http://p:18000'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch)
    // heartbeat + 空状态（无 workbenchId）→ acquireAndHeartbeat 抛普通 Error → run() 归一 500
    const res = await service.heartbeat({ ...HOST_CTX, method: 'POST' as const, path: '/api/heartbeat' })
    expect(res.status).toBe(500)
    expect((res.json as { error: { code: string } }).error.code).toBe('WORKBENCH_ERROR')
  })
})
