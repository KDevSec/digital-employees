import { exportJWK, generateKeyPair } from 'jose'
import { describe, expect, it, vi } from 'vitest'

import { MachineTokenManager } from '../src/app/platform-access/machine-token'
import type { PlatformClient } from '../src/app/platform-access/platform-client'

async function privateJwkFixture() {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  return exportJWK(privateKey)
}

function platformStub(tokens: string[], expiresIn = 300) {
  const calls: string[] = []
  const platform = {
    machineToken: vi.fn(async () => {
      calls.push('acquire')
      // 模拟一次网络往返耗时，让并发请求有机会挤进同一窗口
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { accessToken: tokens.shift() ?? 'token-x', expiresInSeconds: expiresIn }
    }),
  }
  return { platform: platform as unknown as PlatformClient, calls }
}

describe('MachineTokenManager（A-05：缓存 + 到期刷新 + 单飞 A-Q4）', () => {
  it('缓存命中：同 workbenchId 二次 get 不重签', async () => {
    const { platform, calls } = platformStub(['mt-1'])
    const manager = new MachineTokenManager()
    const jwk = await privateJwkFixture()
    const input = { workbenchId: 'wb-1', privateJwk: jwk, tokenEndpoint: 'http://p/token', platform }

    expect(await manager.get(input)).toBe('mt-1')
    expect(await manager.get(input)).toBe('mt-1')
    expect(calls).toHaveLength(1)
  })

  it('临期重签：剩余效期低于 margin（默认 30s）→ 重新获取', async () => {
    const { platform, calls } = platformStub(['mt-1', 'mt-2'], 40) // 40s 效期 > 30s margin，首次缓存
    const manager = new MachineTokenManager()
    const jwk = await privateJwkFixture()
    const input = { workbenchId: 'wb-1', privateJwk: jwk, tokenEndpoint: 'http://p/token', platform }

    expect(await manager.get(input)).toBe('mt-1')
    // 快进 15s：剩余 25s < 30s margin → 重签（仅伪造 Date 跳时钟；stub 内部 10ms 往返走真实定时器）
    vi.useFakeTimers({ now: Date.now() + 15_000, toFake: ['Date'] })
    try {
      expect(await manager.get(input)).toBe('mt-2')
    } finally {
      vi.useRealTimers()
    }
    expect(calls).toHaveLength(2)
  })

  it('单飞：并发 get 合并为一次获取（token 端点只被打一次）', async () => {
    const { platform, calls } = platformStub(['mt-shared'])
    const manager = new MachineTokenManager()
    const jwk = await privateJwkFixture()
    const input = { workbenchId: 'wb-1', privateJwk: jwk, tokenEndpoint: 'http://p/token', platform }

    const [a, b, c] = await Promise.all([manager.get(input), manager.get(input), manager.get(input)])
    expect(a).toBe('mt-shared')
    expect(b).toBe('mt-shared')
    expect(c).toBe('mt-shared')
    expect(calls).toHaveLength(1)
  })
})
