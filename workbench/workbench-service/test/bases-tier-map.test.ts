import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyTierMap, resolveConfiguredModel, resolveTierModel, TIER_ORDER } from '../src/adapters/common/tier-map'
import { readTierMap, writeTierMap } from '../src/bases/tier-map-store'

/**
 * 底座全局档位表（V0.1）：按底座一份，落 ~/.devzero/bases/<base>-tiers.json。
 * 空档 = 跟随 CLI 默认（不加 --model）；不按名单顺序预填。
 */

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'wb-tiers-'))
}

describe('tier-map-store（底座全局默认，与探测缓存同门不同文件）', () => {
  it('未写过 → 五档皆空串', () => {
    const dir = scratchDir()
    expect(readTierMap(dir, 'qoder')).toEqual({
      评审安全档: '',
      设计档: '',
      探索档: '',
      编码档: '',
      执行档: '',
    })
  })

  it('写入后读回；文件里多余键丢弃', () => {
    const dir = scratchDir()
    writeTierMap(dir, 'codebuddy', {
      ...emptyTierMap(),
      编码档: 'hy3',
      执行档: 'glm-5.3',
    })
    const file = join(dir, 'codebuddy-tiers.json')
    writeFileSync(file, JSON.stringify({
      ...emptyTierMap(),
      编码档: 'hy3',
      extra: 'nope',
    }, null, 2), 'utf8')
    expect(readTierMap(dir, 'codebuddy')).toEqual({
      评审安全档: '',
      设计档: '',
      探索档: '',
      编码档: 'hy3',
      执行档: '',
    })
    expect(readTierMap(dir, 'qoder').编码档).toBe('')
  })

  it('已存 id 读回原样（名单漂移也不静默清空）', () => {
    const dir = scratchDir()
    writeTierMap(dir, 'qoder', { ...emptyTierMap(), 编码档: 'gone-model' })
    expect(readTierMap(dir, 'qoder').编码档).toBe('gone-model')
  })

  it('损坏文件 / 非对象 JSON → 五档全空，不抛错', () => {
    const dir = scratchDir()
    const empty = emptyTierMap()
    writeFileSync(join(dir, 'qoder-tiers.json'), '{not-json', 'utf8')
    expect(readTierMap(dir, 'qoder')).toEqual(empty)
    writeFileSync(join(dir, 'codebuddy-tiers.json'), JSON.stringify(['编码档', 'auto']), 'utf8')
    expect(readTierMap(dir, 'codebuddy')).toEqual(empty)
  })
})

describe('resolveConfiguredModel（空档省略；CC 仍走桩）', () => {
  it('claude-code 五档仍解析出桩 id（页隐藏规格允许）', () => {
    for (const tier of TIER_ORDER) {
      const stub = resolveTierModel('claude-code', tier)
      expect(resolveConfiguredModel('claude-code', tier, emptyTierMap())).toBe(stub.id)
      expect(stub.id).toBeTruthy()
    }
  })

  it('Qoder/CodeBuddy：空档 → undefined（调用方不加 --model）', () => {
    expect(resolveConfiguredModel('qoder', '编码档', emptyTierMap())).toBeUndefined()
    expect(resolveConfiguredModel('codebuddy', '设计档', emptyTierMap())).toBeUndefined()
  })

  it('Qoder/CodeBuddy：已配 id 原样返回（含已不在探测名单的）', () => {
    const overlay = { ...emptyTierMap(), 编码档: 'auto', 评审安全档: 'stale-id' }
    expect(resolveConfiguredModel('qoder', '编码档', overlay)).toBe('auto')
    expect(resolveConfiguredModel('qoder', '评审安全档', overlay)).toBe('stale-id')
    expect(resolveConfiguredModel('codebuddy', '编码档', overlay)).toBe('auto')
  })
})
