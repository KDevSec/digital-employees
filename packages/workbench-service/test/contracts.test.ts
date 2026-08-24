import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { brand } from '../src/brand'
import {
  detectCrash,
  getOrCreateInstallationId,
  markCleanStop,
  readReliability,
  readServiceHandle,
  writeReliability,
  writeServiceHandle,
} from '../src/runtime/contracts'
import type { ReliabilityState } from '../src/runtime/contracts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let profileDir: string
let runDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-contracts-'))
  runDir = join(profileDir, 'run')
})

describe('writeServiceHandle / readServiceHandle（S-04 发现契约）', () => {
  it('写 run/service.json：全字段（设计 §6.1）+ 单值兼容层', () => {
    writeServiceHandle(runDir, { pid: 123, port: 19980, uid: 'u1' })

    const onDisk = JSON.parse(readFileSync(join(runDir, 'service.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk.schemaVersion).toBe(1)
    expect(onDisk.app).toBe('workbench')
    expect(onDisk.pid).toBe(123)
    expect(onDisk.port).toBe(19980)
    expect(onDisk.host).toBe('127.0.0.1')
    expect(onDisk.version).toBe(brand.version)
    expect(typeof onDisk.buildCommitId).toBe('string')
    expect((onDisk.buildCommitId as string).length).toBeGreaterThan(0)
    expect(onDisk.uid).toBe('u1')
    expect(onDisk.instanceId).toMatch(UUID_RE)
    expect(!Number.isNaN(Date.parse(onDisk.startedAt as string))).toBe(true)

    // 单值兼容层：供非 JSON 读者
    expect(readFileSync(join(runDir, 'service.pid'), 'utf8').trim()).toBe('123')
    expect(readFileSync(join(runDir, 'service.port'), 'utf8').trim()).toBe('19980')
  })

  it('readServiceHandle 往返一致', () => {
    const written = writeServiceHandle(runDir, { pid: 123, port: 19980, uid: 'u1' })
    expect(readServiceHandle(runDir)).toEqual(written)
  })

  it('文件不存在 → null', () => {
    expect(readServiceHandle(runDir)).toBeNull()
  })
})

describe('writeReliability / readReliability / markCleanStop（S-04 崩溃检测）', () => {
  it('默认写入：schemaVersion 1 / cleanStop false / runId / startedAt', () => {
    writeReliability(runDir)
    const state = readReliability(runDir)
    expect(state?.schemaVersion).toBe(1)
    expect(state?.cleanStop).toBe(false)
    expect(typeof state?.runId).toBe('string')
    expect((state?.runId ?? '').length).toBeGreaterThan(0)
    expect(!Number.isNaN(Date.parse(state?.startedAt ?? ''))).toBe(true)
  })

  it('显式入参往返一致', () => {
    writeReliability(runDir, { runId: 'run-1', cleanStop: false })
    expect(readReliability(runDir)?.runId).toBe('run-1')
  })

  it('markCleanStop 置 true 且保留其余字段', () => {
    writeReliability(runDir, { runId: 'run-1', cleanStop: false })
    markCleanStop(runDir)
    const state = readReliability(runDir)
    expect(state?.cleanStop).toBe(true)
    expect(state?.runId).toBe('run-1')
  })

  it('readReliability 文件不存在 → null', () => {
    expect(readReliability(runDir)).toBeNull()
  })

  it('detectCrash：cleanStop=false → true；cleanStop=true → false；无记录 → false', () => {
    const crashed: ReliabilityState = {
      schemaVersion: 1,
      runId: 'run-1',
      startedAt: new Date().toISOString(),
      cleanStop: false,
    }
    expect(detectCrash(crashed)).toBe(true)
    expect(detectCrash({ ...crashed, cleanStop: true })).toBe(false)
    expect(detectCrash(null)).toBe(false)
  })
})

describe('getOrCreateInstallationId（装机稳定 ID）', () => {
  it('无则生成 UUID 写入 <profile>/installation-id，重复调用稳定复用', () => {
    const first = getOrCreateInstallationId(profileDir)
    expect(first).toMatch(UUID_RE)
    expect(existsSync(join(profileDir, 'installation-id'))).toBe(true)
    expect(getOrCreateInstallationId(profileDir)).toBe(first)
  })
})
