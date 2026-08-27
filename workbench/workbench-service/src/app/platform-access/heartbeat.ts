/**
 * 后台心跳调度（A-05 核心：demo 手动按钮 → 60s 定时器自动化，设计 §2.3）：
 * - ensureRunning 幂等：workbenchId 在才起（服务启动 + 激活成功两处调用）
 * - 失败退避 2/4/8/16/32s 封顶（A-Q2 临时立场），成功回 60s；持续失败不放弃（设计 §2.5）
 * - 心跳 401/403 → status REVOKED 落盘（偏差 #10 近似映射，精确错误码留联调）
 * - stop：优雅退出挂接（详设 §14 通知后台任务停）
 */
import type { PlatformClient, WorkbenchConfiguration } from './platform-client'
import { PlatformError } from './platform-client'
import type { MachineTokenManager } from './machine-token'
import type { WorkbenchStateStore } from './state-store'

const INTERVAL_MS = 60_000
const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 32_000]

export interface HeartbeatDeps {
  stateStore: WorkbenchStateStore
  platform: PlatformClient
  machineTokens: MachineTokenManager
}

export type TickResult = 'ok' | 'revoked' | 'fail'

export class HeartbeatScheduler {
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private consecutiveFails = 0

  constructor(private readonly deps: HeartbeatDeps) {}

  ensureRunning(): void {
    if (this.running) return
    void (async () => {
      const state = await this.deps.stateStore.loadOrCreate()
      if (!state.workbenchId) return
      this.running = true
      this.scheduleNext(0)
    })()
  }

  stop(): void {
    this.running = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      void this.tickAndReschedule()
    }, delayMs)
  }

  private async tickAndReschedule(): Promise<void> {
    await this.tick()
    if (!this.running) return
    const delay = this.consecutiveFails > 0
      ? BACKOFF_STEPS_MS[Math.min(this.consecutiveFails - 1, BACKOFF_STEPS_MS.length - 1)]
      : INTERVAL_MS
    this.scheduleNext(delay)
  }

  async tick(): Promise<TickResult> {
    const state = await this.deps.stateStore.loadOrCreate()
    if (!state.workbenchId) return 'fail'
    try {
      const configuration: WorkbenchConfiguration = await this.deps.platform.discover()
      const token = await this.deps.machineTokens.get({
        workbenchId: state.workbenchId,
        privateJwk: state.privateJwk,
        tokenEndpoint: configuration.machine_token_endpoint,
        platform: this.deps.platform,
      })
      const result = await this.deps.platform.heartbeat(state.workbenchId, token)
      state.lastHeartbeatAt = result.received_at
      state.status = 'ACTIVE'
      await this.deps.stateStore.save(state)
      this.consecutiveFails = 0
      return 'ok'
    } catch (error) {
      this.consecutiveFails++
      if (error instanceof PlatformError && (error.status === 401 || error.status === 403)) {
        state.status = 'REVOKED'
        await this.deps.stateStore.save(state)
        return 'revoked'
      }
      return 'fail'
    }
  }
}
