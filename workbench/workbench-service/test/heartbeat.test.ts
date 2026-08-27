import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HeartbeatScheduler } from '../src/app/platform-access/heartbeat'
import { MachineTokenManager } from '../src/app/platform-access/machine-token'
import { PlatformError } from '../src/app/platform-access/platform-client'
import { WorkbenchStateStore } from '../src/app/platform-access/state-store'

const SECRET = 'test-secret-that-is-at-least-32-chars'

// fake timers 的 advanceTimersByTimeAsync 每跳定时器只让渡约一个真实宏任务，
// 而 tick 链是 5+ 次串行 fs 往返——settle 用真实定时器给异步链一个收尾窗口（模块加载时捕获真实 setTimeout）。
const REAL_SET_TIMEOUT = globalThis.setTimeout
async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>((resolve) => REAL_SET_TIMEOUT(resolve, 0))
  }
}

describe('HeartbeatScheduler（A-05：demo 手动按钮 → 后台自动化）', () => {
  let store: WorkbenchStateStore

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-heartbeat-'))
    store = new WorkbenchStateStore(join(dir, 'state.enc'), SECRET)
  })

  afterEach(() => vi.useRealTimers())

  async function activatedState() {
    const state = await store.loadOrCreate()
    state.workbenchId = 'wb-1'
    state.status = 'ACTIVE'
    await store.save(state)
    return state
  }

  it('tick 成功：机器 token（经缓存管理器）→ 心跳 → lastHeartbeatAt + ACTIVE 落盘', async () => {
    await activatedState()
    const platform = {
      discover: vi.fn(async () => ({ machine_token_endpoint: 'http://p/token' })),
      heartbeat: vi.fn(async () => ({ received_at: '2026-08-27T01:00:00Z' })),
      machineToken: vi.fn(async () => ({ accessToken: 'mt', expiresInSeconds: 300 })),
    }
    const scheduler = new HeartbeatScheduler({ stateStore: store, platform: platform as never, machineTokens: new MachineTokenManager() })

    const result = await scheduler.tick()
    expect(result).toBe('ok')
    const state = await store.loadOrCreate()
    expect(state.lastHeartbeatAt).toBe('2026-08-27T01:00:00Z')
    expect(state.status).toBe('ACTIVE')
    expect(platform.heartbeat).toHaveBeenCalledWith('wb-1', 'mt')
  })

  it('心跳 401/403 → 状态 REVOKED 落盘（顶栏告警数据源，偏差 #10 近似映射）', async () => {
    await activatedState()
    const platform = {
      discover: vi.fn(async () => ({ machine_token_endpoint: 'http://p/token' })),
      heartbeat: vi.fn(async () => { throw new PlatformError(401, 'MACHINE_TOKEN_REVOKED', '已吊销') }),
      machineToken: vi.fn(async () => ({ accessToken: 'mt', expiresInSeconds: 300 })),
    }
    const scheduler = new HeartbeatScheduler({ stateStore: store, platform: platform as never, machineTokens: new MachineTokenManager() })

    expect(await scheduler.tick()).toBe('revoked')
    expect((await store.loadOrCreate()).status).toBe('REVOKED')
  })

  it('网络失败 → 状态不动，返回 fail（持续失败不放弃——退避后继续）', async () => {
    await activatedState()
    const platform = {
      discover: vi.fn(async () => { throw new PlatformError(503, 'PLATFORM_UNREACHABLE', '不可达') }),
      heartbeat: vi.fn(),
      machineToken: vi.fn(),
    }
    const scheduler = new HeartbeatScheduler({ stateStore: store, platform: platform as never, machineTokens: {} as never })

    expect(await scheduler.tick()).toBe('fail')
    expect((await store.loadOrCreate()).status).toBe('ACTIVE')
  })

  it('退避序列：连续失败下一跳间隔 2s→4s→…封顶 32s；成功回 60s（fake timers 驱动）', async () => {
    vi.useFakeTimers()
    await activatedState()
    let calls = 0
    const platform = {
      discover: vi.fn(async () => {
        calls++
        if (calls <= 2) throw new PlatformError(503, 'PLATFORM_UNREACHABLE', '不可达')
        return { machine_token_endpoint: 'http://p/token' }
      }),
      heartbeat: vi.fn(async () => ({ received_at: '2026-08-27T01:00:00Z' })),
      machineToken: vi.fn(async () => ({ accessToken: 'mt', expiresInSeconds: 300 })),
    }
    const scheduler = new HeartbeatScheduler({ stateStore: store, platform: platform as never, machineTokens: new MachineTokenManager() })
    const delays: number[] = []
    const originalSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0)
      return originalSetTimeout(fn, ms)
    }) as typeof setTimeout)

    scheduler.ensureRunning() // workbenchId 在 → 起跑（首跳立即）
    await settle()                                  // ensureRunning 异步读盘完成 → +0 定时器注册
    await vi.advanceTimersByTimeAsync(10)      // 第 1 跳 fail → 下一跳 2s
    await settle()                                  // 第 1 跳链收尾 → 2s 定时器注册
    await vi.advanceTimersByTimeAsync(2_000)   // 第 2 跳 fail → 下一跳 4s
    await settle()
    await vi.advanceTimersByTimeAsync(4_000)   // 第 3 跳 ok → 下一跳 60s
    await settle()                                  // 第 3 跳含 4 连 fs 写——收尾后 60s 定时器才注册
    expect(delays.slice(0, 3)).toEqual([0, 2_000, 4_000])
    expect(delays[3]).toBe(60_000)
  })

  it('ensureRunning 幂等且无 workbenchId 不起；stop 清定时器', async () => {
    vi.useFakeTimers()
    const platform = { discover: vi.fn(), heartbeat: vi.fn(), machineToken: vi.fn() }
    const scheduler = new HeartbeatScheduler({ stateStore: store, platform: platform as never, machineTokens: {} as never })
    await store.loadOrCreate() // 预热落盘（NEW 态无 workbenchId）：两次 ensureRunning 并发 loadOrCreate 会在空库上双写竞态
    scheduler.ensureRunning()
    scheduler.ensureRunning()
    await settle()
    await vi.advanceTimersByTimeAsync(10) // 无 workbenchId：不起定时器
    expect(platform.discover).not.toHaveBeenCalled() // discover 由 tick 内调用：无 workbenchId 时 tick 不该走到

    await activatedState()
    scheduler.ensureRunning()
    await settle() // 读盘完成 → +0 定时器注册
    await vi.advanceTimersByTimeAsync(10)
    scheduler.stop()
    await settle() // 飞行中的首跳链收尾：discover 恰被调一次；stop 后 tickAndReschedule 不再续跳
    expect(platform.discover).toHaveBeenCalledTimes(1) // 激活后首跳立即触发一次
    await vi.advanceTimersByTimeAsync(120_000)
    expect(platform.discover).toHaveBeenCalledTimes(1) // stop 清定时器——不再有新跳
  })
})
