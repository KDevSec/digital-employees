import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPlatformConfig, savePlatformConfig } from '../src/api/platform-config'

/**
 * 平台地址配置 API 层（I0-5 T8，设计 D-13~D-18 方案 A）：
 * - fetchPlatformConfig：GET /api/config/platform，沿 api/health.ts 手法——同源相对路径 +
 *   2s 超时 + 失败/非 2xx/形状不对归一 null（外部对象不可信容错）；
 * - savePlatformConfig：PUT /api/config/platform，返回形状沿 api/access.ts 的 ActionResult
 *   先例——失败透传服务端 error.message（service 侧错误形状 {error:{code,message}} 沿 demo
 *   PlatformError 处理器），网络异常归一失败结果不抛出。
 * 本文件为 node 纯逻辑环境（无 jsdom 头注释，D-10 环境分流），fetch 以 stubGlobal 顶替。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  }
}

describe('fetchPlatformConfig（GET /api/config/platform，失败/形状不对归一 null）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('成功 → { baseUrl }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ baseUrl: 'http://192.168.1.5:18000' })))
    await expect(fetchPlatformConfig()).resolves.toEqual({ baseUrl: 'http://192.168.1.5:18000' })
  })

  it('请求 GET /api/config/platform（同源相对路径）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ baseUrl: 'http://127.0.0.1:18000' }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchPlatformConfig()
    expect(fetchMock).toHaveBeenCalledWith('/api/config/platform', expect.objectContaining({ signal: expect.anything() }))
  })

  it('非 2xx → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })))
    await expect(fetchPlatformConfig()).resolves.toBeNull()
  })

  it('网络异常 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    await expect(fetchPlatformConfig()).resolves.toBeNull()
  })

  it('响应体非 JSON → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => Promise.reject(new Error('not json')) })))
    await expect(fetchPlatformConfig()).resolves.toBeNull()
  })

  it('baseUrl 非字符串（形状不对）→ null（外部对象不可信容错）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ baseUrl: 123 })))
    await expect(fetchPlatformConfig()).resolves.toBeNull()
  })

  it('2s 超时（挂起不响应）→ abort → null', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })))
    const pending = fetchPlatformConfig()
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toBeNull()
  })
})

describe('savePlatformConfig（PUT /api/config/platform，形状沿 ActionResult 先例）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功 → { ok: true, message: 已保存 }；PUT JSON body { baseUrl } 到 /api/config/platform', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ baseUrl: 'http://10.0.0.8:18000' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(savePlatformConfig('http://10.0.0.8:18000')).resolves.toEqual({ ok: true, message: '已保存' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/config/platform',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'http://10.0.0.8:18000' }),
      }),
    )
  })

  it('400 → { ok: false, message: 服务端 error.message 透传 }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { code: 'INVALID_PLATFORM_URL', message: '平台地址必须以 http:// 或 https:// 开头' } }, { ok: false, status: 400, statusText: 'Bad Request' })))
    await expect(savePlatformConfig('ftp://x')).resolves.toEqual({ ok: false, message: '平台地址必须以 http:// 或 https:// 开头' })
  })

  it('400 且响应体无 error.message → message 回退 statusText（沿 postAction 兜底链）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 400, statusText: 'Bad Request' })))
    await expect(savePlatformConfig('x')).resolves.toEqual({ ok: false, message: 'Bad Request' })
  })

  it('网络异常 → { ok: false } 归一失败不抛出（沿 postAction 语义）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    const result = await savePlatformConfig('http://10.0.0.8:18000')
    expect(result.ok).toBe(false)
    expect(result.message.length).toBeGreaterThan(0)
  })
})
