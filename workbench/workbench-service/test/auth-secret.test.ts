import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadOrCreateAuthSecret } from '../src/app/platform-access/auth-secret'

/**
 * A-06 加密密钥加载。控制端裁决（2026-08-27）：同步实现——
 * Task 14（service 装配）须同步拿到密钥，故从源头即同步，测试同步断言（无 await）。
 */

describe('loadOrCreateAuthSecret（A-06）', () => {
  it('首启生成 ≥32 字符随机密钥并落盘 state.key；二次调用返回同一值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-auth-secret-'))
    const first = loadOrCreateAuthSecret(dir)
    expect(first.length).toBeGreaterThanOrEqual(32)
    const onDisk = readFileSync(join(dir, 'state.key'), 'utf8').trim()
    expect(onDisk).toBe(first)
    expect(loadOrCreateAuthSecret(dir)).toBe(first)
  })

  it('已有合法密钥 → 原样复用不重生成', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-auth-secret-'))
    writeFileSync(join(dir, 'state.key'), 'existing-secret-that-is-at-least-32-chars\n', 'utf8')
    expect(loadOrCreateAuthSecret(dir)).toBe('existing-secret-that-is-at-least-32-chars')
  })

  it('已有文件但损坏（<32 字符）→ 重新生成并落盘（设计 §6 恢复路径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-auth-secret-'))
    writeFileSync(join(dir, 'state.key'), 'corrupt-short\n', 'utf8')
    const regenerated = loadOrCreateAuthSecret(dir)
    expect(regenerated).not.toBe('corrupt-short')
    expect(regenerated.length).toBeGreaterThanOrEqual(32)
    expect(readFileSync(join(dir, 'state.key'), 'utf8').trim()).toBe(regenerated)
  })

  it('demo 环境变量默认密钥形态不入场——密钥文件内容与任何固定字符串无关（随机性冒烟）', () => {
    const a = loadOrCreateAuthSecret(mkdtempSync(join(tmpdir(), 'wb-auth-secret-')))
    const b = loadOrCreateAuthSecret(mkdtempSync(join(tmpdir(), 'wb-auth-secret-')))
    expect(a).not.toBe(b)
    expect(a).not.toContain('development-only')
  })
})
