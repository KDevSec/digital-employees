/**
 * 启动序列 + 优雅退出编排（S-13/S-14，设计 §3/§14）。
 * 编排本身零直接 IO——所有副作用经 deps 注入（可测）；
 * 纯判定逻辑（decideInstanceAction/describeAction/detectCrash）直接 import 复用。
 */
import type { WorkbenchConfig } from '../config/schema'
import type { BannerInfo } from '../logging/logger'
import type { ReliabilityState, ServiceHandle } from './contracts'
import { detectCrash } from './contracts'
import { decideInstanceAction, describeAction } from './instance'
import type { HealthSnapshot } from './instance'

/** 配置/环境错误退出码（设计 §4：78 = OS 不徒劳重启） */
export const EXIT_CONFIG_ERROR = 78

/** 首启开浏览器哨兵名（设计 §3.1 第 9 步：仅一次） */
export const FIRST_RUN_SENTINEL = 'first-run-browser-opened'

export class ExitError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'ExitError'
  }
}

/** 编排所需的最小 logger 形状（真实 Logger 结构兼容） */
export interface LifecycleLogger {
  lifecycle(event: string, payload?: Record<string, unknown>): void
  banner(info: BannerInfo): void
}

export interface StartupDeps {
  loadConfig(): WorkbenchConfig | Promise<WorkbenchConfig>
  readReliability(): ReliabilityState | null | Promise<ReliabilityState | null>
  readServiceHandle(): ServiceHandle | null | Promise<ServiceHandle | null>
  probeHealth(handle: ServiceHandle | null): HealthSnapshot | Promise<HealthSnapshot>
  /** 清 run/ 契约文件（takeover 与退出路径使用） */
  clearRunDir(): void | Promise<void>
  startServer(config: WorkbenchConfig): unknown | Promise<unknown>
  /** 写发现契约 run/service.json，返回完整句柄（供 banner 与 reliability 关联） */
  writeServiceHandle(server: unknown, config: WorkbenchConfig): ServiceHandle | Promise<ServiceHandle>
  /** 写崩溃检测契约 run/reliability.json（cleanStop=false） */
  writeReliability(handle: ServiceHandle): ReliabilityState | Promise<ReliabilityState>
  logger: LifecycleLogger
  openBrowser(port: number): void | Promise<void>
  sentinelExists(name: string): boolean | Promise<boolean>
  writeSentinel(name: string): void | Promise<void>
}

export interface StartupOutcome {
  /** 起服务分支返回 server 句柄；idempotent/starting 分支为 null（main 据此直接退出 0） */
  server: unknown | null
  config: WorkbenchConfig
  /** 决策分支（main 据此决定保持前台或静默退出） */
  action: 'fresh' | 'takeover' | 'idempotent' | 'starting'
  /** 起服务分支写入的句柄 */
  handle?: ServiceHandle
}

/**
 * 启动序列（设计 §3.1 裁剪到 V0.1 无守护/无 GC/无孤儿回收）：
 * 1 loadConfig → 2 崩溃检测 → 3 单实例判定五分支 → 4 起服务写契约 →
 * 5 启动横幅 → 6 首启哨兵开浏览器 → 返回 {server, config} 供 main 持有。
 */
export async function runStartup(deps: StartupDeps): Promise<StartupOutcome> {
  const config = await deps.loadConfig()
  const port = config.network.port

  // 2. 崩溃检测（上次 cleanStop=false 即视为异常退出，记 lifecycle 供排障）
  const reliability = await deps.readReliability()
  if (reliability !== null && detectCrash(reliability)) {
    deps.logger.lifecycle('crash_detected', {
      runId: reliability.runId,
      startedAt: reliability.startedAt,
    })
  }

  // 3. 单实例判定
  const handle = await deps.readServiceHandle()
  const health = await deps.probeHealth(handle)
  const action = decideInstanceAction(handle, health)

  switch (action.kind) {
    case 'idempotent':
      // 自家实例已在跑：开浏览器后由 main 退出 0（不起服务）
      await deps.openBrowser(port)
      return { server: null, config, action: 'idempotent' }
    case 'conflict':
      // 第三方占用：78 退出，文案含占用方信息（describeAction）
      throw new ExitError(EXIT_CONFIG_ERROR, describeAction(action, handle))
    case 'starting':
      // 另一实例启动中：静默返回（main 退出 0）
      deps.logger.lifecycle('other_instance_starting', { pid: handle?.pid, port })
      return { server: null, config, action: 'starting' }
    case 'takeover':
      // 僵死实例接管：先清 run/ 再继续起服务
      await deps.clearRunDir()
      break
    case 'fresh':
      break
  }

  // 4. 起服务 + 写契约（healthz 可达性由 startServer 内部 listen 回调保证）
  const server = await deps.startServer(config)
  const written = await deps.writeServiceHandle(server, config)
  await deps.writeReliability(written)

  // 5. 启动横幅（lifecycle.log 的 started 事件，设计 §11）
  deps.logger.banner({
    version: written.version,
    buildCommitId: written.buildCommitId,
    runtime: runtimeDescription(),
    os: process.platform,
    arch: process.arch,
    port,
    instanceId: written.instanceId,
  })

  // 6. 首启哨兵：仅一次自动开浏览器
  if (!(await deps.sentinelExists(FIRST_RUN_SENTINEL))) {
    await deps.openBrowser(port)
    await deps.writeSentinel(FIRST_RUN_SENTINEL)
  }

  return { server, config, action: action.kind, handle: written }
}

export interface ShutdownDeps {
  port: number
  markCleanStop(): void | Promise<void>
  serverStop(): void | Promise<void>
  /** 删 run/ 契约文件（service.json/service.pid/service.port/reliability.json） */
  clearRunDir(): void | Promise<void>
  verifyPortReleased(port: number): boolean | Promise<boolean>
  logger?: { lifecycle(event: string, payload?: Record<string, unknown>): void }
}

/**
 * 优雅退出（设计 §14）：
 * markCleanStop → serverStop → 清 run/ 契约 → 验证端口释放（失败抛错）→ stopped 事件。
 */
export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  await deps.markCleanStop()
  await deps.serverStop()
  await deps.clearRunDir()
  const released = await deps.verifyPortReleased(deps.port)
  if (!released) {
    throw new Error(
      `端口 ${deps.port} 在服务停止后仍未释放（疑似孤儿监听），请检查该端口的占用进程后重试`,
    )
  }
  deps.logger?.lifecycle('stopped', { port: deps.port })
}

function runtimeDescription(): string {
  const bunVersion = process.versions.bun
  return bunVersion ? `Bun ${bunVersion}` : `node ${process.version}`
}
