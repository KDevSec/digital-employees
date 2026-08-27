import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createPlatformAccess } from '../src/app/platform-access'
import { getOrCreateInstallationId } from '../src/runtime/contracts'
import { loadConfig } from '../src/config/load'
import { brand } from '../src/brand'
import { Engine } from '@devzero/engine'
import { createRegistry } from '../src/server/registry'
import { registerAllRoutes } from '../src/server/routes'
import { toHonoApp } from '../src/server/hono-adapter'

describe('main 装配形态（startRealServer 同构：全域注册 + guard 注入）', () => {
  it('registerAllRoutes 装配后：八认证端点 + 既有端点全部在场，auth 档路由有 guard 可注入不炸', () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'wb-assembly-'))
    const installationId = getOrCreateInstallationId(profileDir)
    const { service, scheduler } = createPlatformAccess({ profileDir, loadConfig, installationId, version: brand.version })

    const registry = createRegistry()
    registerAllRoutes(registry, {
      version: brand.version,
      pid: process.pid,
      uid: installationId,
      dataDir: profileDir,
      uptime: () => 0,
      indexHtml: '<html></html>',
      profileDir,
      loadConfig,
      writeConfigOverride: () => {},
      // L3/L2 已合流域依赖（RouteDeps 并集必含；本测试不触达，占位即可）
      engine: new Engine({ dataDir: profileDir, templatesDir: join(profileDir, 'templates', 'flows') }),
      registryFile: join(profileDir, 'registry.json'),
      staffRoot: join(profileDir, 'digital-staff'),
      authSourceDirs: { 'claude-code': '', codebuddy: '', qoder: '' },
      probe: () => ({ present: false, version: null }),
      packageRoots: {},
      cacheDir: join(profileDir, 'bases'),
      run: async () => ({ code: 127, stdout: '' }),
      service,
    })
    const app = toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })

    // 端点清单断言（method+path 全集）
    const endpoints = registry.routes.map((r) => `${r.method} ${r.path}`).sort()
    for (const expected of [
      'GET /healthz', 'GET /api/events', 'GET /api/activity',
      'GET /api/config/platform', 'PUT /api/config/platform',
      'GET /api/state', 'POST /api/logout',
      'GET /auth/login', 'GET /auth/callback',
      'POST /api/enroll', 'POST /api/progress', 'POST /api/reset', 'POST /api/heartbeat',
    ]) {
      expect(endpoints).toContain(expected)
    }

    // 开发态冒烟（默认 profile 无配置）
    return (async () => {
      const state = await app.request('/api/state')
      expect(state.status).toBe(200)
      expect(((await state.json()) as { installationId: string }).installationId).toBe(installationId)
      const login = await app.request('/auth/login')
      expect(login.status).toBe(503)
      scheduler.stop()
    })()
  })
})
