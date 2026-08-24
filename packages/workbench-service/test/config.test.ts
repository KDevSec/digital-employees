import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { brand } from '../src/brand'
import { defaultConfig } from '../src/config/schema'
import { loadConfig, writeSample } from '../src/config/load'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wb-config-'))
})

describe('brand（品牌唯一来源）', () => {
  it('app / defaultPort / profileName', () => {
    expect(brand.app).toBe('workbench')
    expect(brand.defaultPort).toBe(19980)
    expect(typeof brand.profileName).toBe('string')
    expect(brand.profileName.length).toBeGreaterThan(0)
  })
})

describe('loadConfig', () => {
  it('无文件 → 全默认', () => {
    expect(loadConfig(dir)).toEqual({ network: { port: 19980 } })
  })

  it('只写 network.port 覆盖项 → 生效且其余默认', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ network: { port: 1234 } }), 'utf8')
    const cfg = loadConfig(dir)
    expect(cfg.network.port).toBe(1234)
    expect(cfg).toEqual({ network: { port: 1234 } })
  })

  it('network 为空对象 → port 走默认（只写覆盖项语义，设计 §5）', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ network: {} }), 'utf8')
    expect(loadConfig(dir).network.port).toBe(19980)
  })

  it('port 类型非法 → 抛 ZodError', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ network: { port: 'abc' } }), 'utf8')
    expect(() => loadConfig(dir)).toThrow(ZodError)
  })

  it('port 超范围 → 抛 ZodError', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ network: { port: 70000 } }), 'utf8')
    expect(() => loadConfig(dir)).toThrow(ZodError)
  })

  it('未知顶层键 → strict 模式抛 ZodError', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ foo: 1 }), 'utf8')
    expect(() => loadConfig(dir)).toThrow(ZodError)
  })

  it('顶层 _comment 字段宽松忽略（设计 §5.3）', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ _comment: '说明文字', network: { port: 1234 } }),
      'utf8',
    )
    expect(loadConfig(dir).network.port).toBe(1234)
  })
})

describe('writeSample', () => {
  it('生成含 _comment 的 config.sample.json，且 sample 本身能通过 loadConfig 校验', () => {
    writeSample(dir)
    const samplePath = join(dir, 'config.sample.json')
    expect(existsSync(samplePath)).toBe(true)

    const sample = JSON.parse(readFileSync(samplePath, 'utf8')) as Record<string, unknown>
    expect('_comment' in sample).toBe(true)
    expect(sample.network).toEqual({ port: 19980 })

    // 把 sample 复制为用户文件 → loadConfig 校验通过
    copyFileSync(samplePath, join(dir, 'config.json'))
    expect(loadConfig(dir)).toEqual(defaultConfig)
  })
})
