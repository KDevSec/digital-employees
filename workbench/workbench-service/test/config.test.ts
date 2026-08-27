import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { brand } from '../src/brand'
import { defaultConfig, isDevEnvironment } from '../src/config/schema'
import { loadConfig, writeConfigOverride, writeSample } from '../src/config/load'

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
    expect(loadConfig(dir)).toEqual({
      network: { port: 19980 },
      platform: { baseUrl: '' }, // D-049（2026-08-27）：默认未配置平台 = 开发环境（原 T8 默认 http://127.0.0.1:18000 废止）
    })
  })

  it('只写 network.port 覆盖项 → 生效且其余默认', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ network: { port: 1234 } }), 'utf8')
    const cfg = loadConfig(dir)
    expect(cfg.network.port).toBe(1234)
    expect(cfg).toEqual({
      network: { port: 1234 },
      platform: { baseUrl: '' }, // 未写的键走默认（只写覆盖项语义不变；D-049 默认空 = 开发环境）
    })
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

  it('非法 JSON → 抛出 message 含文件路径的 Error', () => {
    writeFileSync(join(dir, 'config.json'), '{ broken', 'utf8')
    expect(() => loadConfig(dir)).toThrow(/config\.json/)
  })
})

describe('platform.baseUrl（I0-5 T8 + D-049：平台地址存 config.json 覆盖键；未配置 = 开发环境）', () => {
  it('无文件 → 默认空串 = 开发环境（D-049：原 T8 默认 http://127.0.0.1:18000 废止，未配置即开发语义）', () => {
    expect(loadConfig(dir).platform.baseUrl).toBe('')
  })

  it('baseUrl 显式空串 → 合法（清除配置回开发环境的落盘形态；D-049）', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ platform: { baseUrl: '' } }), 'utf8')
    expect(loadConfig(dir).platform.baseUrl).toBe('')
  })

  it('只写 platform.baseUrl 覆盖项 → 生效且其余默认（只写覆盖项语义不变）', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    const cfg = loadConfig(dir)
    expect(cfg.platform.baseUrl).toBe('http://192.168.1.5:18000')
    expect(cfg.network.port).toBe(19980)
  })

  it('非 http(s) scheme（ftp://）→ 抛 ZodError（z.string().url() 收任意 scheme，限 http(s) 由 refine 收口；PUT 与加载同一判据，schema 单源）', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'ftp://example.com' } }), 'utf8')
    expect(() => loadConfig(dir)).toThrow(ZodError)
  })

  it('isDevEnvironment：baseUrl 空 = true / 已配置 = false（D-049 单一判据，config/session 两域共用）', () => {
    expect(isDevEnvironment(loadConfig(dir))).toBe(true)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }), 'utf8')
    expect(isDevEnvironment(loadConfig(dir))).toBe(false)
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

describe('writeConfigOverride（I0-5 T8：只写覆盖键，深合并保留既有键，D-13）', () => {
  it('无既有文件 → 写出仅含覆盖键的 config.json，且可被 loadConfig 读回', () => {
    writeConfigOverride(dir, { platform: { baseUrl: 'http://10.0.0.8:18000' } })
    const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(onDisk).toEqual({ platform: { baseUrl: 'http://10.0.0.8:18000' } })
    expect(loadConfig(dir).platform.baseUrl).toBe('http://10.0.0.8:18000')
  })

  it('既有 network.port 与 _comment → 合并保留不被覆盖', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ _comment: '手工注释', network: { port: 1234 } }), 'utf8')
    writeConfigOverride(dir, { platform: { baseUrl: 'http://10.0.0.8:18000' } })
    const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(onDisk).toEqual({
      _comment: '手工注释',
      network: { port: 1234 },
      platform: { baseUrl: 'http://10.0.0.8:18000' },
    })
  })

  it('二次覆盖同键 → 后值胜，幂等编辑路径', () => {
    writeConfigOverride(dir, { platform: { baseUrl: 'http://a.example:18000' } })
    writeConfigOverride(dir, { platform: { baseUrl: 'http://b.example:18000' } })
    expect(loadConfig(dir).platform.baseUrl).toBe('http://b.example:18000')
  })

  it('原子写不留 .tmp 残留（tmp+rename，沿 runtime/contracts atomicWrite 手法）', () => {
    writeConfigOverride(dir, { platform: { baseUrl: 'http://a.example:18000' } })
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
