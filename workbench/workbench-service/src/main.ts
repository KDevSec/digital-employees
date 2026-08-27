/**
 * main 组装（S-02/S-13/S-14）：CLI 命令面 + 真实依赖注入。
 * 本文件不经单元测试覆盖（runStartup/runShutdown/CLI 均为注入可测的纯编排），
 * 端到端正确性由 scripts/smoke.sh 冒烟验证（含坏 config 78 场景）。
 *
 * 平台事实（Windows 实测 2026-08-24）：跨进程 process.kill(pid,'SIGTERM') 是硬杀
 * （TerminateProcess），目标进程的 SIGTERM handler 不会执行——因此 `stop` 子命令在
 * kill 前做 healthz 身份校验（防误杀）、确认端口释放后自行完成善后簿记，见 stopCommand。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createPlatformAccess } from './app/platform-access'
import type { BaseId } from './adapters/contract'
import { readCache as readBaseCache } from './bases/cache'
import { brand } from './brand'
import { loadConfig, writeConfigOverride, writeSample } from './config/load'
import type { WorkbenchConfig } from './config/schema'
import { buildProgram } from './cli'
import type { CliDeps, StartOptions } from './cli'
import { createLogger } from './logging/logger'
import type { Logger } from './logging/logger'
import {
  getOrCreateInstallationId,
  markCleanStop,
  readReliability,
  readServiceHandle,
  writeReliability,
  writeServiceHandle,
} from './runtime/contracts'
import type { ServiceHandle } from './runtime/contracts'
import { ExitError, runShutdown, runStartup } from './runtime/lifecycle'
import type { ShutdownDeps, StartupDeps } from './runtime/lifecycle'
import { TAKEOVER_MIN_CONSECUTIVE_FAILS } from './runtime/instance'
import type { HealthSnapshot } from './runtime/instance'
import { createRegistry } from './server/registry'
import { registerAllRoutes } from './server/routes'
// L3 T6 编排域装配：引擎实例 + 模板目录 ensure（demo 表首启落位）
import { Engine } from '@devzero/engine'
import { buildEngineMcpServer } from './server/mcp/engine-mcp'
import demoFlowYaml from '../../workbench-engine/assets/flows/demo-flow.node-table.yml' with { type: 'text' }
import { toHonoApp } from './server/hono-adapter'

// S-01 嵌入 Web 壳：Bun 运行时/bundler 均以 text 属性内联（--compile 单体产物自带页面）。
// vitest 不支持该导入属性——路由域（routes/）经 deps 注入，此处为唯一 import 点（冒烟覆盖）。
// 类型注意：bun-types 自带 declare module "*.html"（HTMLBundle 类型），
// 与运行时实际返回 string 不符——显式 cast 收窄（tsc --noEmit 消 TS2322）。
import indexHtmlModule from '../web-dist/index.html' with { type: 'text' }
const indexHtml = indexHtmlModule as unknown as string

// ---------- profile 目录（模块级仅路径解析：零 IO、零抛错——stop/status 不依赖 config） ----------

/** env 覆盖入口（测试/冒烟关键）：WORKBENCH_HOME > ~/.devzero */
const profileDir = process.env.WORKBENCH_HOME ?? join(homedir(), brand.profileName)
const runDir = join(profileDir, 'run')
const logsDir = join(profileDir, 'logs')
const sentinelsDir = join(runDir, 'sentinels')
// I1 L2 安装线（设计 §3.1/§3.2）：员工 Deployment 根 ~/digital-staff/（registry.json 台账与各底座 home）
const staffRoot = join(homedir(), 'digital-staff')
// I1 L2 安装线（设计 §9）：底座探测缓存目录（profile 内 bases/<base>.json，30min TTL）
const basesCacheDir = join(profileDir, 'bases')

let startedAtMs = Date.now()

// ---------- A 系列认证装配（Task 16）：心跳调度器模块级句柄 ----------

/** 心跳后台任务句柄（startRealServer 装配时赋值；优雅退出 serverStop 前先停，详设 §14） */
let heartbeatScheduler: { stop(): void } | null = null

// ---------- 守护路径运行时（惰性初始化，I-3：急切初始化会使坏 config 连累 stop/status） ----------

/** start/__daemon 路径的重依赖集合（config/logger/uid） */
interface ServiceRuntime {
  config: WorkbenchConfig
  logger: Logger
  uid: string
}

let serviceRuntime: ServiceRuntime | null = null

/**
 * 守护路径专用初始化：目录树 + config.sample.json + config（加载失败 → ExitError 78，
 * 设计 §4 契约：配置/环境错误=78）+ logger + installation-id。
 * stop/status/portal/activity 一律不经此函数——config 损坏时它们仍须可用。
 */
function initServiceRuntime(): ServiceRuntime {
  if (serviceRuntime) return serviceRuntime
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  mkdirSync(sentinelsDir, { recursive: true })
  writeSample(profileDir) // config.sample.json（首启生成，幂等覆盖）
  const logger = createLogger(logsDir)
  let config: WorkbenchConfig
  try {
    config = loadConfig(profileDir)
  } catch (err) {
    logger.close()
    const detail = err instanceof Error ? err.message : String(err)
    throw new ExitError(
      78,
      `配置文件无法加载（${join(profileDir, 'config.json')}）：${detail}。请修正该文件后重试；删除它则回退默认配置。`,
    )
  }
  const uid = getOrCreateInstallationId(profileDir)
  serviceRuntime = { config, logger, uid }
  return serviceRuntime
}

/** 探测端口解析（不抛错，status/activity/portal/__health-wait 用）：句柄优先，无句柄试读 config，坏 config 走默认端口 */
function resolveProbePort(): number {
  const handle = readServiceHandle(runDir)
  if (handle) return handle.port
  try {
    return loadConfig(profileDir).network.port
  } catch {
    return brand.defaultPort
  }
}

// ---------- 真实依赖实现 ----------

/** 单次 healthz 抓取（2s 超时）。任何 HTTP 应答都算「可达」——非自家 JSON 则 app 缺省（→ conflict 分支）。 */
async function fetchHealth(port: number): Promise<{ reachable: true; app?: string; uid?: string; pid?: number; version?: string } | { reachable: false }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal })
    let body: Record<string, unknown> | undefined
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      // 占用方非 JSON 应答（如 python http.server 的 404 页）→ reachable=true 且 app 缺省
    }
    return {
      reachable: true,
      app: typeof body?.app === 'string' ? body.app : undefined,
      uid: typeof body?.uid === 'string' ? body.uid : undefined,
      pid: typeof body?.pid === 'number' ? body.pid : undefined,
      version: typeof body?.version === 'string' ? body.version : undefined,
    }
  } catch {
    return { reachable: false }
  } finally {
    clearTimeout(timer)
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 探测快照（设计 §8 判据）：连续失败按重试次数计，elapsedMs 自句柄 startedAt 起算。 */
async function probeHealthSnapshot(handle: ServiceHandle | null): Promise<HealthSnapshot> {
  if (!handle) return { reachable: false, pidAlive: false, consecutiveFails: 0, elapsedMs: 0 }
  let fails = 0
  for (let attempt = 0; attempt < TAKEOVER_MIN_CONSECUTIVE_FAILS; attempt++) {
    const one = await fetchHealth(handle.port)
    if (one.reachable) {
      return {
        reachable: true,
        app: one.app,
        uid: one.uid,
        pid: one.pid,
        pidAlive: true,
        consecutiveFails: fails,
        elapsedMs: elapsedMsSince(handle),
      }
    }
    fails++
    if (attempt < TAKEOVER_MIN_CONSECUTIVE_FAILS - 1) await sleep(1000)
  }
  return {
    reachable: false,
    pidAlive: isPidAlive(handle.pid),
    consecutiveFails: fails,
    elapsedMs: elapsedMsSince(handle),
  }
}

function elapsedMsSince(handle: ServiceHandle): number {
  const started = Date.parse(handle.startedAt)
  return Number.isNaN(started) ? 0 : Math.max(0, Date.now() - started)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** bases 域探测命令执行（CmdRunner 生产实现：`<cmd> --version` 抓 stdout 与退出码，5s 兜底超时）。
 * Windows CLI 多为 .cmd/.ps1 shim，无 shell 直 spawn 会 ENOENT——shell 包装（探测只读、args 为固定旗标）。 */
function runBaseVersion(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: process.platform === 'win32' })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), 5_000)
    child.stdout?.on('data', (d) => { stdout += d })
    child.on('error', () => { clearTimeout(timer); resolve({ code: 127, stdout: '' }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 127, stdout }) })
  })
}

function startRealServer(cfg: WorkbenchConfig, rt: ServiceRuntime): ReturnType<typeof Bun.serve> {
  // A 系列装配（Task 16，详设 §3.1）：platform-access = 八认证端点 handler 门面 + 心跳调度器
  const installationId = rt.uid
  const access = createPlatformAccess({ profileDir, loadConfig, installationId, version: brand.version })
  heartbeatScheduler = access.scheduler
  const registry = createRegistry()
  // 编排域（L3 T6）：EngineDirs 注入（D-045 布局——templatesDir 在 profileDir 侧）；
  // 首启 ensure demo-flow 表落位（bun --compile 单体内 assets 以 text 内联，不依赖 fs 布局）
  const flowsDir = join(profileDir, 'templates', 'flows')
  if (!existsSync(join(flowsDir, 'demo-flow.node-table.yml'))) {
    mkdirSync(flowsDir, { recursive: true })
    writeFileSync(join(flowsDir, 'demo-flow.node-table.yml'), demoFlowYaml as unknown as string)
  }
  const engine = new Engine({ dataDir: profileDir, templatesDir: flowsDir })
  registerAllRoutes(registry, {
    version: brand.version,
    pid: process.pid,
    uid: rt.uid,
    dataDir: profileDir,
    uptime: () => Date.now() - startedAtMs,
    indexHtml,
    // I0-5 T8 config 域（设计 D-14）：平台地址读写落在真实 profile 的 config.json（D-13）
    profileDir,
    loadConfig,
    writeConfigOverride,
    engine,
    // I1 L2 安装线两域（设计 §3/§9/§10）：installs + bases 装配——
    // 员工包目录 E 系列接管前为空表（execute/plan 对未知员工 404——装配口径非域契约）；
    // 探测为同步桥（InstallServiceDeps.probe 同步签名）：读 bases 域探测缓存文件，
    // 实探与回写由 GET /api/bases / POST /api/bases/probe 负责（UI 动线先见底座页再安装）。
    registryFile: join(staffRoot, 'registry.json'),
    staffRoot,
    authSourceDirs: {
      'claude-code': join(homedir(), '.claude'),
      codebuddy: '',
      qoder: join(homedir(), '.qoder'),
    },
    probe: (base: BaseId) => readBaseCache(join(basesCacheDir, `${base}.json`)) ?? { present: false, version: null },
    packageRoots: {},
    cacheDir: basesCacheDir,
    run: runBaseVersion,
    // A 系列认证域（Task 16，详设 §3.1）：platform-access 门面（auth/session/enrollment 三域消费切片）
    service: access.service,
  })
  // app 组装必须在路由注册之后（toHonoApp 遍历 routes 数组为快照——顺序反了即全 404）；
  // MCP 例外口（L3）+ 会话守卫（A 系列 A-08）经同一 opts 并集注入
  const app = toHonoApp(registry, {
    mcpServer: buildEngineMcpServer(engine),
    sessionGuard: (ctx, grade) => access.service.sessionGuard(ctx, grade),
  })
  startedAtMs = Date.now()
  try {
    const server = Bun.serve({
      port: cfg.network.port,
      hostname: '127.0.0.1',
      fetch: app.fetch,
      // SSE 长连接（/api/engine/stream）空闲保活上限：Bun 默认 10s 会在首个 15s 心跳前掐死
      // 空闲流（L5×L3 联调实锤：EventSource 经代理收 500 → 连接态「已断开」）；255 为 Bun 上限，
      // 心跳 15s 每次写入重置计时，长连接不受影响（mock 侧同款修法，见 scripts/mock-engine-server.ts）
      idleTimeout: 255,
    })
    // 详设 §3.1 第 9 步：服务起 → 后台任务起（心跳调度；workbenchId 在才真起，幂等）
    access.scheduler.ensureRunning()
    return server
  } catch (err) {
    throw new ExitError(78, `监听 127.0.0.1:${cfg.network.port} 失败（端口被占用？）：${String(err)}`)
  }
}

/** 开浏览器（Windows rundll32；测试/冒烟可用 WORKBENCH_NO_BROWSER=1 抑制） */
function openBrowser(port: number): void {
  if (process.env.WORKBENCH_NO_BROWSER === '1') return
  const url = `http://127.0.0.1:${port}`
  const cmd = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args =
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

function sentinelPath(name: string): string {
  return join(sentinelsDir, name)
}

/** 接管路径：清全部 run/ 契约（reliability 随后由 writeReliability 重写） */
function clearRunDirFull(): void {
  for (const f of ['service.json', 'service.pid', 'service.port', 'reliability.json']) {
    rmSync(join(runDir, f), { force: true })
  }
}

/** 退出路径：只删发现契约三件套，保留 reliability.json（cleanStop 已置 true，供下次启动判崩溃；设计 §14） */
function clearDiscoveryFiles(): void {
  for (const f of ['service.json', 'service.pid', 'service.port']) {
    rmSync(join(runDir, f), { force: true })
  }
}

function verifyPortReleased(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true))
    })
  })
}

function buildStartupDeps(rt: ServiceRuntime): StartupDeps {
  return {
    loadConfig: () => structuredClone(rt.config),
    readReliability: () => readReliability(runDir),
    readServiceHandle: () => readServiceHandle(runDir),
    probeHealth: probeHealthSnapshot,
    clearRunDir: clearRunDirFull,
    startServer: (cfg) => startRealServer(cfg, rt),
    writeServiceHandle: (_server, cfg) =>
      writeServiceHandle(runDir, { pid: process.pid, port: cfg.network.port, uid: rt.uid, version: brand.version }),
    writeReliability: (handle) => writeReliability(runDir, { runId: handle.instanceId }),
    logger: rt.logger,
    openBrowser: (port) => {
      // 可观测：用户面浏览器打开意图（WORKBENCH_NO_BROWSER=1 抑制实际动作但保留事件——冒烟断言用）
      rt.logger.lifecycle('browser.open', { url: `http://127.0.0.1:${port}`, suppressed: process.env.WORKBENCH_NO_BROWSER === '1' })
      openBrowser(port)
    },
    sentinelExists: (name) => existsSync(sentinelPath(name)),
    writeSentinel: (name) => {
      mkdirSync(sentinelsDir, { recursive: true })
      writeFileSync(sentinelPath(name), `${new Date().toISOString()}\n`, 'utf8')
    },
  }
}

// ---------- 守护路径（start / __daemon / 无子命令） ----------

/** 「用户主动停止」哨兵：stop 落、start（用户显式）清、__daemon（调度器拉起）见即退。
 *  解决重复触发器守护（S2 模型）下「stop 后下一次分钟级触发把服务拉活」——守护只救崩溃，不对抗用户意志。 */
const USER_STOPPED_SENTINEL = 'user-stopped'

async function daemonEntry(opts: StartOptions): Promise<number> {
  // 调度器路径（__daemon）先查用户停止哨兵：存在则秒退，best-effort 记 lifecycle（profile 可能未初始化/已损坏）
  if (opts.daemon === true && existsSync(sentinelPath(USER_STOPPED_SENTINEL))) {
    const line = JSON.stringify({ ts: new Date().toISOString(), event: 'daemon.skipped_user_stopped', payload: { reason: 'user-stopped 哨兵在，尊重用户停止意志' } })
    console.log(line)
    try {
      mkdirSync(logsDir, { recursive: true })
      appendFileSync(join(logsDir, 'lifecycle.log'), line + '\n', 'utf8')
    } catch { /* profile 不可写时仅 stdout（调度器不采集，无碍） */ }
    return 0
  }
  // 用户显式启动（start / 裸跑）→ 清哨兵（上一次 stop 的意志到此为止）
  if (opts.daemon !== true) {
    try { rmSync(sentinelPath(USER_STOPPED_SENTINEL), { force: true }) } catch { /* 不存在/不可删均无害 */ }
  }
  let rt: ServiceRuntime | null = null
  try {
    rt = initServiceRuntime()
    const runtime = rt // const 捕获：闭包内保持非空收窄
    const startupDeps = buildStartupDeps(runtime)
    if (opts.daemon === true) {
      // 调度器路径（__daemon）永不开浏览器：重复触发守护每分钟拉起时若服务已在跑（任务实例外），
      // 幂等分支会开浏览器——用户每分钟吃一个新标签页（安装实测反馈）。浏览器只属于用户显式动作
      // （start/portal/托盘左键/install）。首启哨兵同理：只写哨兵，不打扰。
      startupDeps.openBrowser = () => {}
    }
    const outcome = await runStartup(startupDeps)
    if (outcome.server === null) {
      // idempotent（已开主页）/ starting（另一实例启动中）→ 静默退出 0
      runtime.logger.close()
      return 0
    }
    const server = outcome.server as ReturnType<typeof Bun.serve>
    const port = outcome.config.network.port

    let shuttingDown = false
    const shutdownDeps: ShutdownDeps = {
      port,
      markCleanStop: () => markCleanStop(runDir),
      serverStop: () => {
        heartbeatScheduler?.stop()
        server.stop(true)
      },
      clearRunDir: clearDiscoveryFiles,
      verifyPortReleased,
      logger: runtime.logger,
    }
    const handleSignal = (signal: 'SIGTERM' | 'SIGINT'): void => {
      if (shuttingDown) return
      shuttingDown = true
      void runShutdown(shutdownDeps)
        .then(() => {
          runtime.logger.close()
          // 设计 §4：SIGTERM 退出码 143（systemd SuccessExitStatus 配套）；Ctrl+C 正常 0
          process.exit(signal === 'SIGTERM' ? 143 : 0)
        })
        .catch((err) => {
          console.error(`优雅退出失败：`, err)
          runtime.logger.close()
          process.exit(1)
        })
    }
    process.on('SIGTERM', () => handleSignal('SIGTERM'))
    process.on('SIGINT', () => handleSignal('SIGINT'))

    // 前台保持：永不 resolve（Bun.serve 监听句柄持有事件循环；stop/信号触发上面的退出路径）
    return await new Promise<number>(() => {})
  } catch (err) {
    if (err instanceof ExitError) {
      console.error(err.message)
      rt?.logger.close()
      return err.code
    }
    rt?.logger.close()
    throw err
  }
}

// ---------- stop 子命令 ----------

/** 轮询 healthz 直至拒连（确认服务真死了） */
async function waitUntilDown(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const one = await fetchHealth(port)
    if (!one.reachable) return true
    await sleep(300)
  }
  return false
}

async function stopCommand(): Promise<number> {
  const handle = readServiceHandle(runDir)
  if (!handle) {
    console.log('未发现运行中的服务（run/service.json 不存在）')
    return 0
  }
  const { pid, port } = handle

  // 0. 身份校验（kill 前确认端口上的服务确实是本工作台且 pid 与契约一致，防误杀）：
  //    - 可达但非自家 app → 拒杀（句柄过期/端口被占），退出 1
  //    - 可达且自家 → 校验 healthz 自报 pid 与契约一致后才杀
  //    - 不可达（僵尸句柄）→ 无法核身，按契约记录执行（pid 可能已被 OS 复用）
  const identity = await fetchHealth(port)
  if (identity.reachable) {
    if (identity.app !== brand.app) {
      console.error(
        `拒绝停止：端口 ${port} 上的服务不是本工作台（healthz 自报 app=${identity.app ?? '未知'}）。run/service.json 可能已过期，请检查端口占用。`,
      )
      return 1
    }
    if (identity.pid !== undefined && identity.pid !== pid) {
      console.error(
        `拒绝停止：端口 ${port} 上服务的 pid（${identity.pid}）与契约记录（${pid}）不一致，疑似陈旧句柄。`,
      )
      return 1
    }
  } else {
    console.log(`（healthz 不可达：契约 pid ${pid} 可能已复用，无法核身，按契约记录执行停止）`)
  }

  // 1. 对句柄 pid 发 SIGTERM（Windows 实测为硬杀——服务进程收不到信号，善后由本命令完成）
  let killIssued = true
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    killIssued = false // ESRCH：进程已死（陈旧句柄），继续走确认与清理
  }

  // 2. 轮询 healthz 拒连确认（杀不死/僵死 → 指引手动处理，退出 1）
  const down = await waitUntilDown(port, 10_000)
  if (!down) {
    console.error(
      killIssued
        ? `无法停止服务：pid ${pid} 仍在监听端口 ${port}。请手动结束该进程（任务管理器，或 taskkill /PID ${pid} /F）后重试。`
        : `端口 ${port} 仍被占用，但句柄 pid ${pid} 已不存在（可能是其他进程）。请检查端口占用。`,
    )
    return 1
  }

  // 3. 善后簿记：cleanStop=true（防下次误报崩溃）+ 删发现契约三件套（保留 reliability.json）
  // 4. 落「用户主动停止」哨兵：重复触发器守护（S2 模型）每分钟拉 __daemon 时见哨兵即退，防「停止后 1 分钟复活」
  markCleanStop(runDir)
  clearDiscoveryFiles()
  try {
    mkdirSync(sentinelsDir, { recursive: true })
    writeFileSync(sentinelPath(USER_STOPPED_SENTINEL), `${new Date().toISOString()}\n`, 'utf8')
  } catch { /* 哨兵写失败不阻断停止（下次触发会拉起——降级为已知缺陷，记 stderr */ }
  console.log(`服务已停止（pid ${pid}，端口 ${port} 已释放；已标记用户主动停止，守护触发将不再自动拉起）`)
  return 0
}

// ---------- status / portal / activity 子命令 ----------

async function statusCommand(): Promise<string> {
  const handle = readServiceHandle(runDir)
  const port = handle ? handle.port : resolveProbePort()
  const health = await fetchHealth(port)
  const own = health.reachable && health.app === brand.app
  const base: Record<string, unknown> = {
    app: brand.app,
    running: own,
    port,
    version: own ? health.version ?? handle?.version ?? brand.version : handle?.version ?? brand.version,
    health: own ? 'ok' : health.reachable ? 'unknown' : 'down',
    pendingUpdate: null,
  }
  if (own) {
    base.pid = health.pid ?? handle?.pid
    base.uptime = handle ? Math.max(0, Date.now() - Date.parse(handle.startedAt)) : undefined
  } else if (handle) {
    base.pid = handle.pid
  }
  return JSON.stringify(base, null, 2)
}

async function portalCommand(opts: { printUrl: boolean }): Promise<number> {
  const port = resolveProbePort()
  const url = `http://127.0.0.1:${port}`
  if (opts.printUrl) {
    console.log(url)
    return 0
  }
  openBrowser(port)
  return 0
}

async function activityCommand(): Promise<string> {
  const port = resolveProbePort()
  const health = await fetchHealth(port)
  if (health.reachable && health.app === brand.app) {
    // 服务在跑：转发 /api/activity（TR-07 优雅停服判据的数据源）
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/activity`, { signal: controller.signal })
      return await res.text()
    } catch {
      // fallthrough
    } finally {
      clearTimeout(timer)
    }
  }
  // 服务不在跑：无活动任务（V0.1 简版语义，托盘仅在 healthz ok 时消费）
  return JSON.stringify({ conversationTasks: 0, triggerTasks: 0 })
}

// ---------- 组装 ----------

const cliDeps: CliDeps = {
  start: daemonEntry,
  stop: stopCommand,
  status: statusCommand,
  portal: portalCommand,
  activity: activityCommand,
  probeHealthz: async () => {
    const one = await fetchHealth(resolveProbePort())
    return one.reachable && one.app === brand.app
  },
  exit: (code) => process.exit(code),
}

buildProgram(cliDeps)
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error('未分类错误：', err)
    serviceRuntime?.logger.close()
    process.exit(1)
  })
