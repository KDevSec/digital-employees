import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerBasesRoutes } from '../src/server/routes/bases'
import type { BasesRouteDeps } from '../src/server/routes/bases'

/**
 * bases 域路由（设计 §10；探测 CmdRunner 注入——生产装配 main.ts 包装 spawn，测试桩）。
 * 桩 runner 对任何命令回 2.1.245：探测解析只看 stdout semver（容忍性单测在 bases-probe.test.ts）。
 */

let deps: BasesRouteDeps

beforeEach(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'wb-routes-b-'))
  deps = {
    cacheDir: join(scratch, 'bases'),
    run: async () => ({ code: 0, stdout: '2.1.245 (Claude Code)\n' }),
    registryFile: join(scratch, 'registry.json'),
  }
})

/** 域装配：只挂 bases 域（域行为聚焦；全量汇总表断言在 routes-registry.test.ts） */
function buildApp() {
  const reg = createRegistry()
  registerBasesRoutes(reg, deps)
  return toHonoApp(reg)
}

describe('bases 域路由（设计 §10；CmdRunner 注入探测）', () => {
  it('GET /api/bases → 三底座卡片（在场/版本/已装员工数）', async () => {
    const res = await buildApp().request('/api/bases')
    expect(res.status).toBe(200)
    const cards = await res.json() as { id: string; present: boolean; version: string | null; employees_count: number }[]
    expect(cards.map((c) => c.id).sort()).toEqual(['claude-code', 'codebuddy', 'qoder'])
    expect(cards[0].present).toBe(true)
    expect(cards[0].version).toBe('2.1.245')
  })

  it('POST /api/bases/probe {base} → 单底座刷新（缓存旁路）', async () => {
    const res = await buildApp().request('/api/bases/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: 'qoder' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { present: boolean }
    expect(typeof body.present).toBe('boolean')
  })

  it('GET /api/bases/claude-code/models → 模型清单（tier 标注）', async () => {
    const res = await buildApp().request('/api/bases/claude-code/models')
    expect(res.status).toBe(200)
    const models = await res.json() as { tier?: string }[]
    expect(models.length).toBeGreaterThan(0)
    expect(models.some((m) => m.tier === '编码档')).toBe(true)
  })
})
