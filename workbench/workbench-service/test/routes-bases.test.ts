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

  it('GET /api/bases/codebuddy/models help 无支持段 → 502 CLI_FAILED 尚未登记', async () => {
    const res = await buildApp().request('/api/bases/codebuddy/models')
    expect(res.status).toBe(502)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('CLI_FAILED')
    expect(body.error.message).toBe('模型命令尚未登记')
  })

  it('GET /api/bases/codebuddy/models help 有支持段 → 200 结构合法的 ModelInfo[]（不钉名单/条数）', async () => {
    deps.run = async (command, args) => {
      if (command === 'codebuddy' && args.includes('--help')) {
        return { code: 0, stdout: 'Currently supported: (id-one, id-two.2)\n', stderr: '' }
      }
      return { code: 0, stdout: '2.140.0\n', stderr: '' }
    }
    const res = await buildApp().request('/api/bases/codebuddy/models')
    expect(res.status).toBe(200)
    const models = await res.json() as { id: string; label: string }[]
    expect(Array.isArray(models)).toBe(true)
    expect(models.length).toBeGreaterThan(0)
    const idRe = /^[a-z0-9][a-z0-9.\-]*$/i
    for (const m of models) {
      expect(m.id).toMatch(idRe)
      expect(m.label).toBe(m.id)
    }
  })

  it('GET /api/bases/qoder/models 未登录 → NOT_LOGGED_IN 信封，不是空数组', async () => {
    deps.run = async (_command, args) => {
      if (args.includes('--list-models')) {
        return { code: 1, stdout: '', stderr: 'Not logged in. Run `qodercli login` to authenticate.\n' }
      }
      return { code: 0, stdout: '1.1.31\n' }
    }
    const res = await buildApp().request('/api/bases/qoder/models')
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NOT_LOGGED_IN')
    expect(body.error.message).toBe('登录后可见')
  })

  it('GET /api/bases/qoder/models 已登录 → ModelInfo[]', async () => {
    deps.run = async (_command, args) => {
      if (args.includes('--list-models')) {
        return { code: 0, stdout: 'auto\nefficient\n', stderr: '' }
      }
      return { code: 0, stdout: '1.1.31\n' }
    }
    const res = await buildApp().request('/api/bases/qoder/models')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'auto', label: 'auto' },
      { id: 'efficient', label: 'efficient' },
    ])
  })
})

describe('POST /api/bases/:id/install（D-bb01：登记名单 npm -g，同步+日志，装完 probe）', () => {
  it('CodeBuddy：npm install -g 官方包，返回日志并再探测', async () => {
    const calls: { command: string; args: string[] }[] = []
    deps.run = async (command, args) => {
      calls.push({ command, args })
      if (command === 'npm') {
        return { code: 0, stdout: 'added 1 package in 2s\n', stderr: '' }
      }
      return { code: 0, stdout: '2.137.1\n', stderr: '' }
    }
    const res = await buildApp().request('/api/bases/codebuddy/install', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as { logs: string; presence: { present: boolean; version: string | null } }
    expect(calls[0]).toEqual({ command: 'npm', args: ['install', '-g', '@tencent-ai/codebuddy-code'] })
    expect(body.logs).toContain('added 1 package')
    expect(body.presence.present).toBe(true)
    expect(body.presence.version).toBe('2.137.1')
    expect(calls.some((c) => c.command === 'codebuddy' && c.args.includes('--version'))).toBe(true)
  })

  it('Qoder：登记包 @qoder-ai/qodercli', async () => {
    deps.run = async (command, args) => {
      if (command === 'npm') {
        expect(args).toEqual(['install', '-g', '@qoder-ai/qodercli'])
        return { code: 0, stdout: 'ok\n', stderr: '' }
      }
      return { code: 0, stdout: '1.1.31\n', stderr: '' }
    }
    const res = await buildApp().request('/api/bases/qoder/install', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as { logs: string; presence: { present: boolean } }
    expect(body.presence.present).toBe(true)
  })

  it('未知底座 → 404 BASE_NOT_FOUND', async () => {
    const res = await buildApp().request('/api/bases/kimi/install', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BASE_NOT_FOUND')
  })

  it('claude-code 未登记安装 → 404 INSTALL_NOT_REGISTERED', async () => {
    const res = await buildApp().request('/api/bases/claude-code/install', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INSTALL_NOT_REGISTERED')
  })

  it('npm 失败 → 502，带日志，不假装装成功', async () => {
    deps.run = async (command) => {
      if (command === 'npm') return { code: 1, stdout: '', stderr: 'npm ERR! network\n' }
      return { code: 127, stdout: '', stderr: '' }
    }
    const res = await buildApp().request('/api/bases/codebuddy/install', { method: 'POST' })
    expect(res.status).toBe(502)
    const body = await res.json() as { error: { code: string }; logs: string }
    expect(body.error.code).toBe('NPM_INSTALL_FAILED')
    expect(body.logs).toContain('npm ERR! network')
  })
})

describe('GET/PUT /api/bases/:id/tiers（底座全局档位，空=跟随 CLI 默认）', () => {
  it('未配置 GET → 五档空串', async () => {
    const res = await buildApp().request('/api/bases/qoder/tiers')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      评审安全档: '',
      设计档: '',
      探索档: '',
      编码档: '',
      执行档: '',
    })
  })

  it('PUT 后 GET 读回；漂移 id 原样保留', async () => {
    const app = buildApp()
    const put = await app.request('/api/bases/codebuddy/tiers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        评审安全档: '',
        设计档: 'hy3',
        探索档: '',
        编码档: 'gone-id',
        执行档: '',
      }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({
      评审安全档: '',
      设计档: 'hy3',
      探索档: '',
      编码档: 'gone-id',
      执行档: '',
    })
    const get = await app.request('/api/bases/codebuddy/tiers')
    expect(await get.json()).toEqual({
      评审安全档: '',
      设计档: 'hy3',
      探索档: '',
      编码档: 'gone-id',
      执行档: '',
    })
    const other = await app.request('/api/bases/qoder/tiers')
    expect((await other.json() as { 编码档: string }).编码档).toBe('')
  })

  it('未知底座 → 404 BASE_NOT_FOUND', async () => {
    const res = await buildApp().request('/api/bases/kimi/tiers')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BASE_NOT_FOUND')
  })

  it('PUT 缺键 → 400 INVALID_REQUEST', async () => {
    const res = await buildApp().request('/api/bases/qoder/tiers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 编码档: 'auto' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_REQUEST')
  })

  it('PUT 五档齐全但多一个键 → 400 INVALID_REQUEST', async () => {
    const res = await buildApp().request('/api/bases/qoder/tiers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        评审安全档: '',
        设计档: '',
        探索档: '',
        编码档: 'auto',
        执行档: '',
        未知档: 'x',
      }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_REQUEST')
  })
})
