import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeBase, assertVersion } from '../src/bases/probe'
import { readCache, writeCache } from '../src/bases/cache'
import { baseProfiles } from '../src/adapters/index'

const cc = baseProfiles['claude-code']
const runnerOk = async () => ({ code: 0, stdout: '2.1.245 (Claude Code)\n' })
const runnerAbsent = async () => ({ code: 127, stdout: '' })

describe('probeBase（设计 §9；探测命令注入式——真探测在 service 装配）', () => {
  it('在场：解析 stdout semver（容忍前后缀文案）', async () => {
    const p = await probeBase(cc, runnerOk)
    expect(p.present).toBe(true)
    expect(p.version).toBe('2.1.245')
  })

  it('不在场：code≠0 → present=false version=null', async () => {
    const p = await probeBase(cc, runnerAbsent)
    expect(p.present).toBe(false)
    expect(p.version).toBeNull()
  })

  it('stdout 无 semver → present=true 但 version=null（在场但版本不可解析——不冒充不在场）', async () => {
    const p = await probeBase(cc, async () => ({ code: 0, stdout: 'unknown version' }))
    expect(p.present).toBe(true)
    expect(p.version).toBeNull()
  })
})

describe('assertVersion（B-8 安装期断言 + PR-031 major 跳变 WARN）', () => {
  it('版本≥下限 → ok 无 warning', () => {
    expect(assertVersion(cc, { present: true, version: '2.1.245', probed_at: '' })).toEqual({ ok: true })
  })
  it('低于下限 → ok=false', () => {
    expect(assertVersion(cc, { present: true, version: '1.9.0', probed_at: '' }).ok).toBe(false)
  })
  it('major 跳变 → ok=true 带 warning', () => {
    const r = assertVersion(cc, { present: true, version: '3.0.0', probed_at: '' })
    expect(r.ok).toBe(true)
    expect(r.warning).toBeDefined()
  })
  it('version=null（在场但不可解析）→ ok=true 带 warning', () => {
    expect(assertVersion(cc, { present: true, version: null, probed_at: '' }).warning).toBeDefined()
  })
})

describe('探测缓存（~/.devzero/bases/<base>.json；30min TTL）', () => {
  it('写后读命中；过期/缺失 → null', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wb-cache-')), 'claude-code.json')
    const p = { present: true, version: '2.1.245', probed_at: new Date().toISOString() }
    writeCache(file, p)
    expect(readCache(file)?.version).toBe('2.1.245')
    const stale = { ...p, probed_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() }
    writeFileSync(file, JSON.stringify(stale), 'utf8')
    expect(readCache(file)).toBeNull()
    expect(readCache(join(dirname(file), 'missing.json'))).toBeNull()
  })
})
