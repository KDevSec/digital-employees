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
    tierConfigFile: join(scratch, 'bases', 'tier-config.json'),
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

  it('GET /api/bases/:id/tier-config -> 合并后五档映射（未配置 = 内置默认全档）', async () => {
    const res = await buildApp().request('/api/bases/qoder/tier-config')
    expect(res.status).toBe(200)
    const body = await res.json() as { tiers: Record<string, string>; customized: string[] }
    expect(Object.keys(body.tiers).sort()).toEqual(['执行档', '探索档', '编码档', '设计档', '评审安全档'])
    expect(body.tiers['评审安全档']).toBe('Qwen3.8-Max') // D-062 内置默认
    expect(body.customized).toEqual([])
  })

  it('PUT /api/bases/:id/tier-config -> 持久化覆盖，GET 与 models 端点均反映配置（D-062）', async () => {
    const put = await buildApp().request('/api/bases/qoder/tier-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers: {
        评审安全档: 'Qwen3.8-Max', 设计档: 'Qwen3.8-Flash', 探索档: 'Qwen3.8-Max',
        编码档: 'Qwen3.7-Plus', 执行档: 'Qwen3.8-Flash',
      } }),
    })
    expect(put.status).toBe(200)
    const body = await put.json() as { tiers: Record<string, string>; customized: string[] }
    expect(body.tiers['设计档']).toBe('Qwen3.8-Flash')
    expect(body.customized.sort()).toEqual(['执行档', '设计档'])

    // GET 回读：配置落盘（跨 app 实例读同一文件）
    const got = await buildApp().request('/api/bases/qoder/tier-config')
    const gotBody = await got.json() as { tiers: Record<string, string> }
    expect(gotBody.tiers['设计档']).toBe('Qwen3.8-Flash')

    // models 端点合并配置后展平
    const models = await buildApp().request('/api/bases/qoder/models')
    const list = await models.json() as { id: string; tier?: string }[]
    expect(list.filter((m) => m.tier === '设计档')[0]?.id).toBe('Qwen3.8-Flash')
  })

  it('PUT /api/bases/:id/tier-config 校验：五档缺一 -> 400', async () => {
    const res = await buildApp().request('/api/bases/qoder/tier-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers: { 评审安全档: 'Qwen3.8-Max', 设计档: 'Qwen3.7-Max', 探索档: 'Qwen3.8-Max', 编码档: 'Qwen3.7-Plus' } }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/bases/unknown/tier-config -> 404 BASE_NOT_FOUND', async () => {
    const res = await buildApp().request('/api/bases/unknown/tier-config')
    expect(res.status).toBe(404)
  })
})
