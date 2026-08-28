import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPlatformVersion } from '../src/version'

afterEach(() => vi.unstubAllGlobals())

describe('fetchPlatformVersion（025：公开探针取版本）', () => {
  it('200 且带 version → 返回版本字符串', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), { status: 200 })))
    await expect(fetchPlatformVersion()).resolves.toBe('0.1.0')
  })

  it('version 缺失/空白/非字符串 → 归一 null', async () => {
    for (const body of [{ status: 'ok' }, { version: '   ' }, { version: 1 }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
      // eslint-disable-next-line no-await-in-loop
      await expect(fetchPlatformVersion()).resolves.toBeNull()
    }
  })

  it('非 2xx / 网络异常 → null（不抛错、不阻塞页面）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    await expect(fetchPlatformVersion()).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(fetchPlatformVersion()).resolves.toBeNull()
  })
})
