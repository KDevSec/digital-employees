/**
 * 机器 token 管理（A-05；demo 每次心跳重签的浪费按设计 §2.3「到期前自动刷新」修正）：
 * 5min token 缓存 + 剩余效期低于 margin 重签 + 单飞（并发合并为一次获取，A-Q4——
 * V0.1 只有心跳消费方，风险低但机制先行）。
 */
import type { JWK } from 'jose'

import type { PlatformClient } from './platform-client'

interface CachedToken {
  value: string
  expiresAt: number
}

export interface MachineTokenInput {
  workbenchId: string
  privateJwk: JWK
  tokenEndpoint: string
  platform: PlatformClient
}

export class MachineTokenManager {
  private cached?: CachedToken
  private inflight?: Promise<string>

  constructor(private readonly refreshMarginSeconds = 30) {}

  async get(input: MachineTokenInput): Promise<string> {
    if (this.cached !== undefined && this.cached.expiresAt - Date.now() > this.refreshMarginSeconds * 1000) {
      return this.cached.value
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.acquire(input)
    try {
      return await this.inflight
    } finally {
      this.inflight = undefined
    }
  }

  private async acquire(input: MachineTokenInput): Promise<string> {
    const { accessToken, expiresInSeconds } = await input.platform.machineToken(
      input.workbenchId,
      input.privateJwk,
      input.tokenEndpoint,
    )
    this.cached = { value: accessToken, expiresAt: Date.now() + expiresInSeconds * 1000 }
    return accessToken
  }
}
