import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../src/logging/logger'

let logsDir: string

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), 'wb-log-'))
})

interface Line {
  ts: string
  event: string
  payload?: Record<string, unknown>
}

function readLines(file: string): Line[] {
  return readFileSync(join(logsDir, file), 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Line)
}

describe('双轨日志（S-08，设计 §11）', () => {
  it('log() 写 workbench.log、lifecycle() 写 lifecycle.log——两文件分流互不掺', () => {
    const logger = createLogger(logsDir)
    logger.log('request', { path: '/healthz' })
    logger.lifecycle('started', { port: 19980 })
    logger.close()

    const run = readLines('workbench.log')
    const life = readLines('lifecycle.log')
    expect(run).toHaveLength(1)
    expect(run[0]).toMatchObject({ event: 'request', payload: { path: '/healthz' } })
    expect(life).toHaveLength(1)
    expect(life[0]).toMatchObject({ event: 'started', payload: { port: 19980 } })
    expect(run[0].event).not.toBe('started')
  })

  it('JSONL 每行含 ts（ISO8601）+ event + payload', () => {
    const logger = createLogger(logsDir)
    const before = Date.now()
    logger.log('something', { a: 1 })
    logger.close()
    const after = Date.now()

    const [line] = readLines('workbench.log')
    const ts = Date.parse(line.ts)
    expect(Number.isNaN(ts)).toBe(false)
    expect(ts).toBeGreaterThanOrEqual(before - 5)
    expect(ts).toBeLessThanOrEqual(after + 5)
    expect(line.event).toBe('something')
    expect(line.payload).toEqual({ a: 1 })
  })

  it('append：多次写入追加不覆盖', () => {
    const logger = createLogger(logsDir)
    logger.log('e1')
    logger.log('e2')
    logger.close()
    expect(readLines('workbench.log').map((l) => l.event)).toEqual(['e1', 'e2'])
  })

  it('文件 UTF-8 无 BOM', () => {
    const logger = createLogger(logsDir)
    logger.log('中文事件', { msg: '横幅·测试' })
    logger.lifecycle('stopped', { reason: '信号' })
    logger.close()

    for (const f of ['workbench.log', 'lifecycle.log']) {
      const buf = readFileSync(join(logsDir, f))
      expect(buf[0]).not.toBe(0xef) // BOM 前 3 字节 ef bb bf
      const text = buf.toString('utf8')
      expect(text).toContain(f === 'workbench.log' ? '中文事件' : 'stopped')
    }
    const runText = readFileSync(join(logsDir, 'workbench.log'), 'utf8')
    expect(runText).toContain('横幅·测试')
  })

  it('close() 后可再开（文件句柄释放，重新 createLogger 继续写）', () => {
    const first = createLogger(logsDir)
    first.log('before-close')
    first.close()
    expect(() => readLines('workbench.log')).not.toThrow()

    const second = createLogger(logsDir)
    second.log('after-reopen')
    second.close()
    expect(readLines('workbench.log').map((l) => l.event)).toEqual(['before-close', 'after-reopen'])
  })

  it('无 payload 时行为一致（省略 payload 或空对象均可）', () => {
    const logger = createLogger(logsDir)
    logger.log('bare')
    logger.close()
    const [line] = readLines('workbench.log')
    expect(line.event).toBe('bare')
    expect(line.payload === undefined || line.payload === null).toBe(true)
  })
})

describe('启动横幅（设计 §11：started 事件含全部横幅字段）', () => {
  it('banner() 在 lifecycle.log 落一行 started，字段齐全', () => {
    const logger = createLogger(logsDir)
    logger.banner({
      version: '0.1.0',
      buildCommitId: 'abc1234',
      runtime: 'Bun 1.3.9',
      os: 'win32',
      arch: 'x64',
      port: 19980,
      instanceId: 'inst-42',
    })
    logger.close()

    const life = readLines('lifecycle.log')
    expect(life).toHaveLength(1)
    const line = life[0]
    expect(line.event).toBe('started')
    expect(line.payload).toMatchObject({
      version: '0.1.0',
      buildCommitId: 'abc1234',
      runtime: 'Bun 1.3.9',
      os: 'win32',
      arch: 'x64',
      port: 19980,
      instanceId: 'inst-42',
    })
    expect(line.ts).toBeDefined()
  })

  it('banner 事件不落 workbench.log', () => {
    const logger = createLogger(logsDir)
    logger.banner({ version: '0.1.0', buildCommitId: 'd', runtime: 'Bun 1.3.9', os: 'win32', arch: 'x64', port: 1, instanceId: 'i' })
    logger.close()
    expect(existsSync(join(logsDir, 'workbench.log'))).toBe(false)
  })
})

describe('大小轮转（maxBytes 注入，简版保留 1 份 .1）', () => {
  it('超过 maxBytes 后当前文件 rename 为 .1，新文件继续写（旧内容在 .1）', () => {
    const logger = createLogger(logsDir, { maxBytes: 200 })
    logger.log('first-big-event', { pad: 'x'.repeat(80) }) // 单行约 160B
    logger.log('third-event') // 追加后超 200 → 轮转
    logger.close()

    const rotated = readFileSync(join(logsDir, 'workbench.log.1'), 'utf8')
    const current = readFileSync(join(logsDir, 'workbench.log'), 'utf8')
    expect(rotated).toContain('first-big-event')
    expect(current).not.toContain('first-big-event')
    expect(current).toContain('third-event')
  })

  it('再次超限再次轮转：.1 被覆盖为最近一次轮出内容（简版保留 1 份）', () => {
    const logger = createLogger(logsDir, { maxBytes: 200 })
    logger.log('e1', { pad: 'x'.repeat(80) })
    logger.log('e2', { pad: 'y'.repeat(80) }) // 第 1 次轮转：.1=[e1]，current=[e2]
    logger.log('e3', { pad: 'z'.repeat(80) }) // 第 2 次轮转：.1=[e2]（覆盖），current=[e3]
    logger.close()
    expect(readFileSync(join(logsDir, 'workbench.log.1'), 'utf8')).toContain('e2')
    const current = readFileSync(join(logsDir, 'workbench.log'), 'utf8')
    expect(current).toContain('e3')
    expect(current).not.toContain('e1')
  })

  it('轮转覆盖旧的 .1（只保留 1 份）', () => {
    const logger = createLogger(logsDir, { maxBytes: 100 })
    for (let i = 0; i < 12; i++) logger.log(`event-${i}`, { pad: 'z'.repeat(40) })
    logger.close()

    const files = readdirSync(logsDir).filter((f) => f.startsWith('workbench.log')).sort()
    expect(files).toEqual(['workbench.log', 'workbench.log.1'])
  })

  it('lifecycle 轨独立轮转（与 workbench 轨互不影响）', () => {
    const logger = createLogger(logsDir, { maxBytes: 150 })
    logger.log('run-a', { pad: 'a'.repeat(60) })
    logger.lifecycle('life-a', { pad: 'b'.repeat(60) })
    logger.log('run-b', { pad: 'c'.repeat(60) })
    logger.lifecycle('life-b', { pad: 'd'.repeat(60) })
    logger.close()

    const currentRun = readFileSync(join(logsDir, 'workbench.log'), 'utf8')
    const rotatedRun = readFileSync(join(logsDir, 'workbench.log.1'), 'utf8')
    expect(currentRun).toContain('run-b')
    expect(rotatedRun).toContain('run-a')

    const currentLife = readFileSync(join(logsDir, 'lifecycle.log'), 'utf8')
    const rotatedLife = readFileSync(join(logsDir, 'lifecycle.log.1'), 'utf8')
    expect(currentLife).toContain('life-b')
    expect(rotatedLife).toContain('life-a')
  })
})

describe('边界', () => {
  it('目录不存在时自动创建', () => {
    const dir = join(logsDir, 'nested', 'logs')
    const logger = createLogger(dir)
    logger.log('auto-mkdir')
    logger.close()
    expect(existsSync(join(dir, 'workbench.log'))).toBe(true)
  })

  it('close() 幂等（重复 close 不抛）', () => {
    const logger = createLogger(logsDir)
    logger.log('x')
    logger.close()
    expect(() => logger.close()).not.toThrow()
  })

  it('close() 后再写不抛（静默丢弃）', () => {
    const logger = createLogger(logsDir)
    logger.log('x')
    logger.close()
    expect(() => logger.log('after-close')).not.toThrow()
  })
})

afterEach(() => {
  rmSync(logsDir, { recursive: true, force: true })
})
