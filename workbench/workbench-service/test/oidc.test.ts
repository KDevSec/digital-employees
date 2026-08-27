import { exportJWK, generateKeyPair, SignJWT, importJWK } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { exchangeCodeAndVerify, OidcFlowStore, oidcDocument } from '../src/app/platform-access/oidc'
import type { WorkbenchConfiguration } from '../src/app/platform-access/platform-client'

const CONFIG: WorkbenchConfiguration = {
  platform_base_url: 'http://p:18000',
  oidc_issuer: 'http://p:18000/oauth2/workbench',
  oidc_client_id: 'workbench-desktop',
  enrollment_endpoint: 'http://p:18000/api/v1/workbench-enrollments',
  machine_token_endpoint: 'http://p:18000/oauth2/workbench/token',
  protocol_version: 'v1',
}

afterEach(() => vi.unstubAllGlobals())

describe('OidcFlowStore', () => {
  it('create → take 单次使用：取后同名 state 不可再取', () => {
    const store = new OidcFlowStore()
    const { state } = store.create(CONFIG, 'verifier-1')
    expect(store.take(state)?.verifier).toBe('verifier-1')
    expect(store.take(state)).toBeUndefined()
  })

  it('过期流程 take 返回 undefined（5min TTL；vi.setSystemTime 越时）', () => {
    vi.useFakeTimers()
    try {
      const store = new OidcFlowStore()
      const { state } = store.create(CONFIG, 'v')
      vi.setSystemTime(Date.now() + 300_001)
      expect(store.take(state)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('create 机会式清扫：过期项不滞留（Map 不无限增长）', () => {
    vi.useFakeTimers()
    try {
      const store = new OidcFlowStore()
      const first = store.create(CONFIG, 'v1')
      vi.setSystemTime(Date.now() + 300_001)
      store.create(CONFIG, 'v2')
      vi.setSystemTime(Date.now() + 300_001)
      expect(store.take(first.state)).toBeUndefined() // 已被清扫（而非仅 TTL 拒绝）
      expect((store as unknown as { flows: Map<string, unknown> }).flows.size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('oidcDocument', () => {
  it('issuer 匹配 → 返回文档', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      issuer: CONFIG.oidc_issuer,
      authorization_endpoint: 'http://p:18000/oauth2/auth',
      token_endpoint: 'http://p:18000/oauth2/token',
      jwks_uri: 'http://p:18000/oauth2/certs',
    }), { status: 200 })) as unknown as typeof fetch)
    const document = await oidcDocument(CONFIG.oidc_issuer)
    expect(document.issuer).toBe(CONFIG.oidc_issuer)
  })

  it('issuer 不匹配 → 502 OIDC_ISSUER_MISMATCH（配置与发现文档不一致的防线）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ issuer: 'http://other:18000/x' }), { status: 200 })) as unknown as typeof fetch)
    const error = (await oidcDocument(CONFIG.oidc_issuer).catch((e: unknown) => e)) as { status: number; code: string }
    expect(error.status).toBe(502)
    expect(error.code).toBe('OIDC_ISSUER_MISMATCH')
  })

  it('平台不可达 → 503 PLATFORM_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)
    const error = (await oidcDocument(CONFIG.oidc_issuer).catch((e: unknown) => e)) as { status: number; code: string }
    expect(error.status).toBe(503)
    expect(error.code).toBe('PLATFORM_UNREACHABLE')
  })

  it('discovery 应答非 2xx → 503 PLATFORM_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })) as unknown as typeof fetch)
    const error = (await oidcDocument(CONFIG.oidc_issuer).catch((e: unknown) => e)) as { status: number; code: string }
    expect(error.status).toBe(503)
    expect(error.code).toBe('PLATFORM_UNREACHABLE')
  })
})

describe('exchangeCodeAndVerify（callback 核心，本地 ES256 IdP mock）', () => {
  async function mockIdp(nonce: string): Promise<{ claims: Record<string, unknown> }> {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const privateJwk = await exportJWK(privateKey)
    const publicJwk = await exportJWK(publicKey)
    const idToken = await new SignJWT({ nonce, email: 'user@example.com' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(CONFIG.oidc_issuer)
      .setAudience(CONFIG.oidc_client_id)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(await importJWK(privateJwk, 'ES256'))
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'http://p:18000/oauth2/certs') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
      }
      return new Response(JSON.stringify({ access_token: 'person-access-token', id_token: idToken, expires_in: 300 }), { status: 200 })
    }) as unknown as typeof fetch)
    return { claims: { nonce, email: 'user@example.com', iss: CONFIG.oidc_issuer, aud: CONFIG.oidc_client_id } }
  }

  it('code 换 token + 验签 + nonce 校验通过 → 返回 token 与 claims', async () => {
    const { claims } = await mockIdp('nonce-1')
    const result = await exchangeCodeAndVerify({
      document: { issuer: CONFIG.oidc_issuer, token_endpoint: 'http://p:18000/oauth2/token', jwks_uri: 'http://p:18000/oauth2/certs' },
      configuration: CONFIG,
      flow: { verifier: 'v', nonce: 'nonce-1', createdAt: Date.now(), configuration: CONFIG },
      code: 'auth-code',
      redirectUri: 'http://127.0.0.1:19990/auth/callback',
    })
    expect(result.accessToken).toBe('person-access-token')
    expect(result.expiresInSeconds).toBe(300)
    expect(result.claims).toMatchObject({ nonce: 'nonce-1', email: 'user@example.com' })
    expect(result.claims).toMatchObject(claims)
  })

  it('nonce 不匹配 → 401 PERSON_SESSION_INVALID', async () => {
    await mockIdp('nonce-real')
    const error = (await exchangeCodeAndVerify({
      document: { issuer: CONFIG.oidc_issuer, token_endpoint: 'http://p:18000/oauth2/token', jwks_uri: 'http://p:18000/oauth2/certs' },
      configuration: CONFIG,
      flow: { verifier: 'v', nonce: 'nonce-tampered', createdAt: Date.now(), configuration: CONFIG },
      code: 'auth-code',
      redirectUri: 'http://127.0.0.1:19990/auth/callback',
    }).catch((e: unknown) => e)) as { status: number; code: string }
    expect(error.status).toBe(401)
    expect(error.code).toBe('PERSON_SESSION_INVALID')
  })

  it('token 端点拒绝 → 401 PERSON_SESSION_INVALID（Keycloak 拒授权码语义）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch)
    const error = (await exchangeCodeAndVerify({
      document: { issuer: CONFIG.oidc_issuer, token_endpoint: 'http://p:18000/oauth2/token', jwks_uri: 'http://p:18000/oauth2/certs' },
      configuration: CONFIG,
      flow: { verifier: 'v', nonce: 'n', createdAt: Date.now(), configuration: CONFIG },
      code: 'bad-code',
      redirectUri: 'http://127.0.0.1:19990/auth/callback',
    }).catch((e: unknown) => e)) as { status: number; code: string }
    expect(error.status).toBe(401)
    expect(error.code).toBe('PERSON_SESSION_INVALID')
  })
})
