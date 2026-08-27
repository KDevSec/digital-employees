import { exportJWK, generateKeyPair } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlatformClient, PlatformError } from '../src/app/platform-access/platform-client'

const CONFIG = {
  platform_base_url: 'http://192.168.45.50:18000',
  oidc_issuer: 'http://192.168.45.50:18000/oauth2/workbench',
  oidc_client_id: 'workbench-desktop',
  enrollment_endpoint: 'http://192.168.45.50:18000/api/v1/workbench-enrollments',
  machine_token_endpoint: 'http://192.168.45.50:18000/oauth2/workbench/token',
  protocol_version: 'v1',
}

function jsonFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init)
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('PlatformClient（demo 迁移 + 三处适配）', () => {
  it('discover：GET {base}/.well-known/workbench-configuration', async () => {
    const fetchMock = jsonFetch(() => ({ status: 200, body: CONFIG }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PlatformClient({ getBaseUrl: () => 'http://192.168.45.50:18000', version: '0.0.1' })
    expect(await client.discover()).toEqual(CONFIG)
    expect(vi.mocked(fetchMock).mock.calls[0][0]).toBe('http://192.168.45.50:18000/.well-known/workbench-configuration')
  })

  it('getBaseUrl 运行时读取——换地址后无需重建 client（PUT config 即时生效）', async () => {
    let base = 'http://a:18000'
    const fetchMock = jsonFetch(() => ({ status: 200, body: CONFIG }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PlatformClient({ getBaseUrl: () => base, version: '0.0.1' })
    await client.discover()
    base = 'http://b:18000'
    await client.discover()
    const urls = vi.mocked(fetchMock).mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'http://a:18000/.well-known/workbench-configuration',
      'http://b:18000/.well-known/workbench-configuration',
    ])
  })

  it('submitEnrollment：品牌与版本注入（终端 xxx / deps.version）', async () => {
    let captured: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', jsonFetch((url, init) => {
      captured = { url, ...(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}) }
      return { status: 200, body: { id: 'enr-1', status: 'PENDING_REVIEW' } }
    }))
    const { publicKey } = await generateKeyPair('ES256', { extractable: true })
    const client = new PlatformClient({ getBaseUrl: () => 'http://p:18000', version: '9.9.9' })
    const result = await client.submitEnrollment({ installationId: '12345678-abcd', publicJwk: await exportJWK(publicKey) }, 'person-token')
    expect(result).toEqual({ id: 'enr-1', status: 'PENDING_REVIEW' })
    expect(captured?.url).toBe('http://p:18000/api/v1/workbench-enrollments')
    expect(captured?.display_name).toBe('终端 12345678')
    expect(captured?.workbench_version).toBe('9.9.9')
    expect(captured?.installation_id).toBe('12345678-abcd')
  })

  it('错误归一：非 2xx 带 error.code/message → PlatformError 透传', async () => {
    vi.stubGlobal('fetch', jsonFetch(() => ({ status: 403, body: { error: { code: 'ENROLLMENT_REJECTED', message: '拒绝' } } })))
    const client = new PlatformClient({ getBaseUrl: () => 'http://p:18000', version: '0' })
    const error = (await client.discover().catch((e: unknown) => e)) as PlatformError
    expect(error).toBeInstanceOf(PlatformError)
    expect(error.status).toBe(403)
    expect(error.code).toBe('ENROLLMENT_REJECTED')
  })

  it('错误归一：非 JSON 应答回退 HTTP_<status>', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch)
    const client = new PlatformClient({ getBaseUrl: () => 'http://p:18000', version: '0' })
    const error = (await client.discover().catch((e: unknown) => e)) as PlatformError
    expect(error.code).toBe('HTTP_502')
  })

  it('machineToken：private_key_jwt client_credentials；expires_in 缺省 300', async () => {
    vi.stubGlobal('fetch', jsonFetch(() => ({ status: 200, body: { access_token: 'mt-1' } })))
    const { privateKey } = await generateKeyPair('ES256', { extractable: true })
    const client = new PlatformClient({ getBaseUrl: () => 'http://p:18000', version: '0' })
    const result = await client.machineToken('wb-1', await exportJWK(privateKey), 'http://p:18000/oauth2/workbench/token')
    expect(result).toEqual({ accessToken: 'mt-1', expiresInSeconds: 300 })
  })

  it('heartbeat：body 携带 workbench_version 与 Bearer 机器 token', async () => {
    let captured: { body?: Record<string, unknown>; auth?: string } = {}
    vi.stubGlobal('fetch', jsonFetch((_url, init) => {
      captured = {
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: String((init?.headers as Record<string, string>).Authorization),
      }
      return { status: 200, body: { received_at: '2026-08-27T00:00:00Z' } }
    }))
    const client = new PlatformClient({ getBaseUrl: () => 'http://p:18000', version: '3.2.1' })
    const result = await client.heartbeat('wb-1', 'mt-9')
    expect(result.received_at).toBe('2026-08-27T00:00:00Z')
    expect(captured.body?.workbench_version).toBe('3.2.1')
    expect(captured.body?.event_id).toBeTruthy()
    expect(captured.auth).toBe('Bearer mt-9')
  })
})
