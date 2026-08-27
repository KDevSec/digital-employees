import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/load'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerSessionRoutes } from '../src/server/routes/session'

/**
 * session 域路由（D-049 开发环境桥接，2026-08-27）：GET /api/state。
 * 背景：A 系列（认证后端 demo→service 迁移）未落地，/api/state 此前不存在——web 守卫
 * 拉不到状态一律按未认证（只能看接入页），本地无平台时调试被卡（用户痛点 2026-08-27）。
 * D-049 裁决：平台地址未配置 = 开发环境——本端点注入开发态（authenticated + ACTIVE + 开发用户），
 * web 零改动全放行（顶栏/设置浮层显示「开发模式」用户）；已配置平台地址 = 生产语义 → 401
 * （web fetchAccessState 非 2xx 归一 null → 未认证，与「端点不存在」的现行行为等价）。
 * A 系列落地后本域升级为真实会话端点，开发环境语义沿用 schema.isDevEnvironment 同一判据。
 * 响应形状 = demo /api/state 消费子集（web api/access.ts parseStateJson 契约）：
 * installationId 必须为字符串（整包拒绝判据）+ status 八枚举 + authenticated === true 才认证。
 */

let profileDir: string

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'wb-session-routes-'))
})

/** 域装配：只挂 session 域 */
function buildApp(): ReturnType<typeof toHonoApp> {
  const registry = createRegistry()
  registerSessionRoutes(registry, { profileDir, loadConfig })
  return toHonoApp(registry)
}

describe('分域注册（routes/session.ts 只注册本域端点）', () => {
  it('session 域路由表 = GET /api/state，无其他端点', () => {
    const reg = createRegistry()
    registerSessionRoutes(reg, { profileDir, loadConfig })
    expect(reg.routes.map((r) => [r.method, r.path])).toEqual([['GET', '/api/state']])
  })
})

describe('GET /api/state（D-049 开发环境桥接）', () => {
  it('平台地址未配置（默认）→ 200 开发态：authenticated + ACTIVE + 开发用户（web 零改动全放行）', async () => {
    const res = await buildApp().request('/api/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      installationId: 'dev',
      status: 'ACTIVE',
      authenticated: true,
      user: { name: '开发模式', preferred_username: 'dev', email: 'dev@localhost' },
    })
  })

  it('config.json 显式空串 → 同默认：开发态（清除配置的落盘形态与未配置语义一致）', async () => {
    writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ platform: { baseUrl: '' } }), 'utf8')
    const res = await buildApp().request('/api/state')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { authenticated: boolean }).authenticated).toBe(true)
  })

  it('已配置平台地址 → 401 + {error:{code,message}}（生产语义：与端点不存在的现行行为等价，web 归一未认证）', async () => {
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({ platform: { baseUrl: 'http://192.168.1.5:18000' } }),
      'utf8',
    )
    const res = await buildApp().request('/api/state')
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: { code: string; message: string } }
    expect(json.error.code).toBe('NO_SESSION')
    expect(json.error.message.length).toBeGreaterThan(0)
  })

  it('Host 白名单守卫照常：Host: evil.com → 403（守卫先于 handler，S-12 不因开发环境松动）', async () => {
    const res = await buildApp().request('/api/state', { headers: { Host: 'evil.com' } })
    expect(res.status).toBe(403)
  })
})
