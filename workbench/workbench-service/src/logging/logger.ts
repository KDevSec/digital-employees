/**
 * 双轨日志（S-08，设计 §11）：
 * - logs/workbench.log  运行明细（开发读）
 * - logs/lifecycle.log  生命周期（启停横幅/崩溃/升级/GC——只记生命周期，运维读）
 * 统一 JSONL：{ts, event, payload?}；全 UTF-8 无 BOM（W-17）；
 * 轮转属日志子系统（W-7）：按 maxBytes 超限 rename 为 .1（简版保留 1 份）。
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** 默认轮转阈值（设计 §5.1 logging.rotateMaxBytes 缺省 10MB） */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

export interface BannerInfo {
  version: string
  buildCommitId: string
  runtime: string
  os: string
  arch: string
  port: number
  instanceId: string
}

export interface Logger {
  log(event: string, payload?: Record<string, unknown>): void
  lifecycle(event: string, payload?: Record<string, unknown>): void
  banner(info: BannerInfo): void
  close(): void
}

export interface LoggerOptions {
  /** 单文件字节阈值，超过即轮转（测试注入小值） */
  maxBytes?: number
}

interface Track {
  file: string
  closed: boolean
}

export function createLogger(logsDir: string, options: LoggerOptions = {}): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  mkdirSync(logsDir, { recursive: true })

  const run: Track = { file: join(logsDir, 'workbench.log'), closed: false }
  const life: Track = { file: join(logsDir, 'lifecycle.log'), closed: false }

  function write(track: Track, event: string, payload?: Record<string, unknown>): void {
    if (track.closed) return
    const line =
      JSON.stringify({ ts: new Date().toISOString(), event, ...(payload !== undefined ? { payload } : {}) }) + '\n'
    if (existsSync(track.file)) {
      const size = statSync(track.file).size
      // 超限轮转（rotate-before-append）；空文件不轮转（单行超限仍写入，防无限轮转）
      if (size > 0 && size + Buffer.byteLength(line, 'utf8') > maxBytes) {
        renameSync(track.file, `${track.file}.1`)
      }
    }
    appendFileSync(track.file, line, 'utf8')
  }

  return {
    log(event, payload) {
      write(run, event, payload)
    },
    lifecycle(event, payload) {
      write(life, event, payload)
    },
    banner(info) {
      write(life, 'started', { ...info })
    },
    close() {
      run.closed = true
      life.closed = true
    },
  }
}
