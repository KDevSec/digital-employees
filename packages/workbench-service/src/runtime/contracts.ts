import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brand } from '../brand'

/**
 * run/ 契约文件（S-04，设计 §6）。
 * 外部（托盘壳/脚本/任何工具）对 Service 的认知 = 这些文件 + /healthz。
 * 所有写文件一律「临时文件 + rename」原子写，避免读到半截 JSON。
 */

const SERVICE_JSON = 'service.json'
const SERVICE_PID = 'service.pid'
const SERVICE_PORT = 'service.port'
const RELIABILITY_JSON = 'reliability.json'
const INSTALLATION_ID = 'installation-id'

/** 发现契约：run/service.json（设计 §6.1） */
export interface ServiceHandle {
  schemaVersion: 1
  app: typeof brand.app
  pid: number
  port: number
  host: '127.0.0.1'
  version: string
  buildCommitId: string
  /** 装机稳定 ID（installation-id 同源，A 系列消费） */
  uid: string
  /** 每次启动新生（UUID） */
  instanceId: string
  /** ISO8601 */
  startedAt: string
}

export interface ServiceHandleInput {
  pid: number
  port: number
  uid: string
  version?: string
  buildCommitId?: string
  instanceId?: string
  startedAt?: string
}

/** 崩溃检测契约：run/reliability.json（设计 §6.2） */
export interface ReliabilityState {
  schemaVersion: 1
  runId: string
  startedAt: string
  cleanStop: boolean
}

export type ReliabilityInput = Partial<Pick<ReliabilityState, 'runId' | 'startedAt' | 'cleanStop'>>

function currentBuildCommitId(): string {
  // 字面量成员表达式：build.sh 以 --define "process.env.WORKBENCH_BUILD_COMMIT_ID=..." 编译期固化；
  // 直跑（bun run/vitest）时退化为运行时 env 读取，缺省 'dev'
  return process.env.WORKBENCH_BUILD_COMMIT_ID ?? 'dev'
}

/** 原子写：先写同目录临时文件，再 rename 覆盖目标 */
function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(tmpPath, content, 'utf8')
  renameSync(tmpPath, filePath)
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  atomicWrite(filePath, JSON.stringify(value, null, 2) + '\n')
}

/**
 * 写发现契约：run/service.json + 单值兼容层 run/service.pid、run/service.port。
 * 返回写入的完整句柄（instanceId/startedAt 未指定时自动生成）。
 */
export function writeServiceHandle(runDir: string, input: ServiceHandleInput): ServiceHandle {
  mkdirSync(runDir, { recursive: true })
  const handle: ServiceHandle = {
    schemaVersion: 1,
    app: brand.app,
    pid: input.pid,
    port: input.port,
    host: '127.0.0.1',
    version: input.version ?? brand.version,
    buildCommitId: input.buildCommitId ?? currentBuildCommitId(),
    uid: input.uid,
    instanceId: input.instanceId ?? randomUUID(),
    startedAt: input.startedAt ?? new Date().toISOString(),
  }
  writeJsonAtomic(join(runDir, SERVICE_JSON), handle)
  atomicWrite(join(runDir, SERVICE_PID), `${handle.pid}\n`)
  atomicWrite(join(runDir, SERVICE_PORT), `${handle.port}\n`)
  return handle
}

/** 读发现契约；文件不存在或损坏 JSON → null（advisory 读不懂按不存在，自愈为 fresh） */
export function readServiceHandle(runDir: string): ServiceHandle | null {
  return readJsonOrNull<ServiceHandle>(join(runDir, SERVICE_JSON))
}

/**
 * 写崩溃检测契约；cleanStop 默认 false（启动即声明「本次非正常退出」，退出前置 true）。
 */
export function writeReliability(runDir: string, input: ReliabilityInput = {}): ReliabilityState {
  mkdirSync(runDir, { recursive: true })
  const state: ReliabilityState = {
    schemaVersion: 1,
    runId: input.runId ?? randomUUID(),
    startedAt: input.startedAt ?? new Date().toISOString(),
    cleanStop: input.cleanStop ?? false,
  }
  writeJsonAtomic(join(runDir, RELIABILITY_JSON), state)
  return state
}

/** 读崩溃检测契约；文件不存在或损坏 JSON → null（损坏视为无记录，不算崩溃） */
export function readReliability(runDir: string): ReliabilityState | null {
  return readJsonOrNull<ReliabilityState>(join(runDir, RELIABILITY_JSON))
}

/**
 * 读 JSON 文件；不存在或解析失败（损坏）一律返回 null——
 * run/ 契约文件是 advisory 产物，读不懂时按不存在处理（fresh 自愈），不抛裸异常。
 */
function readJsonOrNull<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

/** 正常退出前调用：置 cleanStop=true（无记录时不创建） */
export function markCleanStop(runDir: string): void {
  const current = readReliability(runDir)
  if (!current) return
  writeJsonAtomic(join(runDir, RELIABILITY_JSON), { ...current, cleanStop: true })
}

/** 上次是否异常退出：读到 cleanStop === false 即崩溃（无记录不算） */
export function detectCrash(state: ReliabilityState | null): boolean {
  return state !== null && state.cleanStop === false
}

/**
 * 装机稳定 ID：`<profile>/installation-id`，无则生成 UUID 写入（原子写），稳定复用。
 * service.json 的 uid 与 A 系列消费的 installation_id 与此同源。
 */
export function getOrCreateInstallationId(profileDir: string): string {
  const filePath = join(profileDir, INSTALLATION_ID)
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8').trim()
    if (existing.length > 0) return existing
  }
  const id = randomUUID()
  mkdirSync(profileDir, { recursive: true })
  atomicWrite(filePath, `${id}\n`)
  return id
}
