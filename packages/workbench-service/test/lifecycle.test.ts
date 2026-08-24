import { describe, expect, it } from 'vitest'
import type { WorkbenchConfig } from '../src/config/schema'
import type { ReliabilityState, ServiceHandle } from '../src/runtime/contracts'
import { ExitError, runShutdown, runStartup } from '../src/runtime/lifecycle'
import type { ShutdownDeps, StartupDeps } from '../src/runtime/lifecycle'
import type { HealthSnapshot } from '../src/runtime/instance'
import type { BannerInfo } from '../src/logging/logger'

const config: WorkbenchConfig = { network: { port: 19980 } }

const fakeHandle: ServiceHandle = {
  schemaVersion: 1,
  app: 'workbench',
  pid: 111,
  port: 19980,
  host: '127.0.0.1',
  version: '0.1.0',
  buildCommitId: 'dev',
  uid: 'u1',
  instanceId: 'inst-1',
  startedAt: '2026-08-24T00:00:00.000Z',
}

const crashedReliability: ReliabilityState = {
  schemaVersion: 1,
  runId: 'run-old',
  startedAt: '2026-08-23T00:00:00.000Z',
  cleanStop: false,
}

interface Overrides {
  handle?: ServiceHandle | null
  health?: Partial<HealthSnapshot>
  reliability?: ReliabilityState | null
  sentinel?: boolean
}

function makeDeps(overrides: Overrides = {}) {
  const calls: string[] = []
  const lifecycleEvents: Array<{ event: string; payload?: Record<string, unknown> }> = []
  const banners: BannerInfo[] = []
  const deps: StartupDeps = {
    loadConfig: async () => {
      calls.push('loadConfig')
      return config
    },
    readReliability: async () => {
      calls.push('readReliability')
      return overrides.reliability ?? null
    },
    readServiceHandle: async () => {
      calls.push('readServiceHandle')
      return overrides.handle ?? null
    },
    probeHealth: async () => {
      calls.push('probeHealth')
      return { reachable: false, pidAlive: false, consecutiveFails: 0, elapsedMs: 0, ...overrides.health }
    },
    clearRunDir: async () => {
      calls.push('clearRunDir')
    },
    startServer: async () => {
      calls.push('startServer')
      return { fake: 'server' }
    },
    writeServiceHandle: async () => {
      calls.push('writeServiceHandle')
      return fakeHandle
    },
    writeReliability: async () => {
      calls.push('writeReliability')
      return { schemaVersion: 1, runId: 'run-new', startedAt: new Date().toISOString(), cleanStop: false }
    },
    logger: {
      lifecycle: (event, payload) => {
        calls.push(`lifecycle:${event}`)
        lifecycleEvents.push({ event, payload })
      },
      banner: (info) => {
        calls.push('banner')
        banners.push(info)
      },
    },
    openBrowser: async () => {
      calls.push('openBrowser')
    },
    sentinelExists: async () => {
      calls.push('sentinelExists')
      return overrides.sentinel ?? false
    },
    writeSentinel: async () => {
      calls.push('writeSentinel')
    },
  }
  return { deps, calls, lifecycleEvents, banners }
}

describe('runStartup（S-13 启动序列编排，设计 §3.1）', () => {
  it('fresh 全序：loadConfig → readReliability → readServiceHandle → probeHealth → startServer → writeServiceHandle → writeReliability → banner → 哨兵判断 → openBrowser → writeSentinel', async () => {
    const { deps, calls } = makeDeps()
    const outcome = await runStartup(deps)

    expect(calls).toEqual([
      'loadConfig',
      'readReliability',
      'readServiceHandle',
      'probeHealth',
      'startServer',
      'writeServiceHandle',
      'writeReliability',
      'banner',
      'sentinelExists',
      'openBrowser',
      'writeSentinel',
    ])
    expect(outcome.server).toEqual({ fake: 'server' })
    expect(outcome.config).toEqual(config)
    expect(outcome.action).toBe('fresh')
    expect(outcome.handle).toEqual(fakeHandle)
  })

  it('fresh + cleanStop=false → 判定（probeHealth）之后、起服务之前记 crash_detected（D-035 晚记）', async () => {
    const { deps, calls, lifecycleEvents } = makeDeps({ reliability: crashedReliability })
    await runStartup(deps)

    const crashIdx = calls.indexOf('lifecycle:crash_detected')
    expect(crashIdx).toBeGreaterThanOrEqual(0)
    expect(crashIdx).toBeGreaterThan(calls.indexOf('probeHealth')) // 单实例判定之后
    expect(crashIdx).toBeLessThan(calls.indexOf('startServer')) // 起服务之前
    const ev = lifecycleEvents.find((e) => e.event === 'crash_detected')
    expect(ev?.payload).toMatchObject({ runId: 'run-old' })
  })

  it('reliability 正常（cleanStop=true）→ 不记 crash_detected', async () => {
    const { deps, lifecycleEvents } = makeDeps({
      reliability: { ...crashedReliability, cleanStop: true },
    })
    await runStartup(deps)
    expect(lifecycleEvents.find((e) => e.event === 'crash_detected')).toBeUndefined()
  })

  it('banner 字段来自句柄 + 配置 + 进程事实（version/buildCommitId/port/instanceId/os/arch/runtime）', async () => {
    const { deps, banners } = makeDeps()
    await runStartup(deps)
    expect(banners).toHaveLength(1)
    expect(banners[0]).toMatchObject({
      version: '0.1.0',
      buildCommitId: 'dev',
      port: 19980,
      instanceId: 'inst-1',
      os: process.platform,
      arch: process.arch,
    })
    expect(banners[0].runtime).toBeTruthy()
  })

  it('哨兵已存在 → 跳过 openBrowser 与 writeSentinel（首启只开一次浏览器）', async () => {
    const { deps, calls } = makeDeps({ sentinel: true })
    await runStartup(deps)
    expect(calls).not.toContain('openBrowser')
    expect(calls).not.toContain('writeSentinel')
    expect(calls).toContain('banner')
  })
})

describe('runStartup 五分支（S-06 判定接入）', () => {
  it('idempotent：openBrowser 后返回，不起服务不写契约', async () => {
    const { deps, calls } = makeDeps({
      handle: fakeHandle,
      health: { reachable: true, app: 'workbench', uid: 'u1', pid: 111, pidAlive: true },
    })
    const outcome = await runStartup(deps)

    expect(calls).toContain('openBrowser')
    expect(calls).not.toContain('startServer')
    expect(calls).not.toContain('writeServiceHandle')
    expect(calls).not.toContain('banner')
    // openBrowser 在判定之后、startServer 之前的位置上（无 startServer）
    expect(calls.indexOf('openBrowser')).toBeGreaterThan(calls.indexOf('probeHealth'))
    expect(outcome.server).toBeNull()
    expect(outcome.action).toBe('idempotent')
  })

  it('conflict：抛 ExitError(code 78)，message 来自 describeAction', async () => {
    const { deps } = makeDeps({
      handle: fakeHandle,
      health: { reachable: true, app: 'someone-else', uid: 'u1', pid: 222, pidAlive: true },
    })
    await expect(runStartup(deps)).rejects.toMatchObject({
      code: 78,
      message: expect.stringContaining('78'),
    })
    await expect(runStartup(deps)).rejects.toBeInstanceOf(ExitError)
  })

  it('takeover：先 clearRunDir 再 startServer（接管僵死实例）', async () => {
    const { deps, calls } = makeDeps({
      handle: fakeHandle,
      health: { reachable: false, pidAlive: true, consecutiveFails: 3, elapsedMs: 31_000 },
    })
    const outcome = await runStartup(deps)

    expect(calls).toContain('clearRunDir')
    expect(calls.indexOf('clearRunDir')).toBeLessThan(calls.indexOf('startServer'))
    expect(outcome.action).toBe('takeover')
    expect(outcome.server).toEqual({ fake: 'server' })
  })

  it('starting：静默返回（不起服务），记 lifecycle other_instance_starting', async () => {
    const { deps, calls, lifecycleEvents } = makeDeps({
      handle: fakeHandle,
      health: { reachable: false, pidAlive: true, consecutiveFails: 1, elapsedMs: 1_000 },
    })
    const outcome = await runStartup(deps)

    expect(calls).not.toContain('startServer')
    expect(calls).not.toContain('clearRunDir')
    expect(outcome.server).toBeNull()
    expect(outcome.action).toBe('starting')
    const ev = lifecycleEvents.find((e) => e.event === 'other_instance_starting')
    expect(ev?.payload).toMatchObject({ pid: 111, port: 19980 })
  })

  it('句柄存在但 pid 已死（陈旧）→ fresh，不 clearRunDir', async () => {
    const { deps, calls } = makeDeps({
      handle: fakeHandle,
      health: { reachable: false, pidAlive: false },
    })
    const outcome = await runStartup(deps)
    expect(outcome.action).toBe('fresh')
    expect(calls).not.toContain('clearRunDir')
    expect(calls).toContain('startServer')
  })
})

describe('runStartup 崩溃检测时序（D-035：早读暂存、晚记——仅 fresh/takeover 接管分支记录）', () => {
  it('幂等（handle + own health + cleanStop=false）→ 返回 0 且 lifecycle 无 crash_detected（钉住）', async () => {
    // 运行中实例的 cleanStop=false 是常态；旧时序会在幂等分支误记 crash（runId 指向健康实例）
    const { deps, calls, lifecycleEvents } = makeDeps({
      handle: fakeHandle,
      reliability: crashedReliability,
      health: { reachable: true, app: 'workbench', uid: 'u1', pid: 111, pidAlive: true },
    })
    const outcome = await runStartup(deps)

    expect(outcome.action).toBe('idempotent')
    expect(outcome.server).toBeNull()
    expect(calls).not.toContain('lifecycle:crash_detected')
    expect(lifecycleEvents.find((e) => e.event === 'crash_detected')).toBeUndefined()
    expect(calls).not.toContain('startServer')
  })

  it('starting（另一实例启动中）+ cleanStop=false → 不记 crash_detected', async () => {
    const { deps, lifecycleEvents } = makeDeps({
      handle: fakeHandle,
      reliability: crashedReliability,
      health: { reachable: false, pidAlive: true, consecutiveFails: 1, elapsedMs: 1_000 },
    })
    await runStartup(deps)
    expect(lifecycleEvents.find((e) => e.event === 'crash_detected')).toBeUndefined()
  })

  it('takeover + cleanStop=false → clearRunDir 之后记（早读暂存值——文件已被删）', async () => {
    const { deps, calls, lifecycleEvents } = makeDeps({
      handle: fakeHandle,
      reliability: crashedReliability,
      health: { reachable: false, pidAlive: true, consecutiveFails: 3, elapsedMs: 31_000 },
    })
    const outcome = await runStartup(deps)

    expect(outcome.action).toBe('takeover')
    const crashIdx = calls.indexOf('lifecycle:crash_detected')
    expect(crashIdx).toBeGreaterThan(calls.indexOf('clearRunDir'))
    expect(crashIdx).toBeLessThan(calls.indexOf('startServer'))
    // 值来自接管前暂存（reliability.json 已被 clearRunDir 删除）
    expect(lifecycleEvents.find((e) => e.event === 'crash_detected')?.payload).toMatchObject({
      runId: 'run-old',
    })
  })

  it('conflict + cleanStop=false → 先记 port_conflict（含占用方）再抛 78，不记 crash_detected', async () => {
    const { deps, lifecycleEvents } = makeDeps({
      handle: fakeHandle,
      reliability: crashedReliability,
      health: { reachable: true, app: 'someone-else', uid: 'u1', pid: 222, pidAlive: true },
    })
    await expect(runStartup(deps)).rejects.toMatchObject({ code: 78 })

    expect(lifecycleEvents.find((e) => e.event === 'crash_detected')).toBeUndefined()
    const ev = lifecycleEvents.find((e) => e.event === 'port_conflict')
    expect(ev?.payload).toMatchObject({ port: 19980 })
    expect(ev?.payload).toMatchObject({ occupant: { pid: 222, app: 'someone-else' } })
  })
})

describe('runShutdown（S-14 优雅退出，设计 §14）', () => {
  function makeShutdownDeps(released: boolean) {
    const calls: string[] = []
    const lifecycleEvents: Array<{ event: string; payload?: Record<string, unknown> }> = []
    const deps: ShutdownDeps = {
      port: 19980,
      markCleanStop: async () => {
        calls.push('markCleanStop')
      },
      serverStop: async () => {
        calls.push('serverStop')
      },
      clearRunDir: async () => {
        calls.push('clearRunDir')
      },
      verifyPortReleased: async (port) => {
        calls.push(`verifyPortReleased:${port}`)
        return released
      },
      logger: {
        lifecycle: (event, payload) => {
          calls.push(`lifecycle:${event}`)
          lifecycleEvents.push({ event, payload })
        },
      },
    }
    return { deps, calls, lifecycleEvents }
  }

  it('全序：markCleanStop → serverStop → clearRunDir → verifyPortReleased → stopped 事件', async () => {
    const { deps, calls, lifecycleEvents } = makeShutdownDeps(true)
    await runShutdown(deps)
    expect(calls).toEqual([
      'markCleanStop',
      'serverStop',
      'clearRunDir',
      'verifyPortReleased:19980',
      'lifecycle:stopped',
    ])
    expect(lifecycleEvents[0]).toMatchObject({ event: 'stopped', payload: { port: 19980 } })
  })

  it('端口未释放 → 抛 Error 且 message 含端口号', async () => {
    const { deps, calls } = makeShutdownDeps(false)
    await expect(runShutdown(deps)).rejects.toThrow(/19980/)
    // 验证发生在前三步之后
    expect(calls).toEqual(['markCleanStop', 'serverStop', 'clearRunDir', 'verifyPortReleased:19980'])
  })

  it('未提供 logger → 不记 stopped 也不抛', async () => {
    const calls: string[] = []
    const deps: ShutdownDeps = {
      port: 1234,
      markCleanStop: async () => {
        calls.push('markCleanStop')
      },
      serverStop: async () => {
        calls.push('serverStop')
      },
      clearRunDir: async () => {
        calls.push('clearRunDir')
      },
      verifyPortReleased: async (port) => {
        calls.push(`verifyPortReleased:${port}`)
        return true
      },
    }
    await runShutdown(deps)
    expect(calls).toEqual(['markCleanStop', 'serverStop', 'clearRunDir', 'verifyPortReleased:1234'])
  })
})
