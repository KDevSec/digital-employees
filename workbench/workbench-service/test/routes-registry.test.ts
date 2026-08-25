import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/server/registry'
import type { Route } from '../src/server/registry'
import { registerAllRoutes } from '../src/server/routes'
import { registerInfraRoutes } from '../src/server/routes/infra'
import { registerShellRoutes } from '../src/server/routes/shell'

/**
 * 路由分域注册约定（I0-5 T1，设计 D-1/D-2/D-3）：
 * routes/<domain>.ts 每域一文件只注册自己的端点，routes/index.ts 静态汇总一行一域，
 * 注册产物 method+path 唯一——I1 并行线撞路由即在此炸，不留给请求期。
 */

/** 域注册依赖：infra 五项 + shell 一项（与 main 装配同形状，值非契约） */
const deps = {
  version: '9.9.9',
  pid: 4321,
  uid: 'uid-abc',
  dataDir: 'D:/data/.devzero',
  uptime: () => 12_345,
  indexHtml: '<html>DevZero</html>',
}

/** 路由表投影：[method, path] 集合比较（注册顺序非契约——排序消除顺序敏感） */
function table(routes: Route[]): string[][] {
  return routes
    .map((r) => [r.method, r.path])
    .sort((a, b) => a.join(' ').localeCompare(b.join(' ')))
}

describe('路由汇总表（routes/index.ts registerAllRoutes）', () => {
  it('注册产物 = 期望路由表（GET /、GET /healthz、GET /api/events、GET /api/activity）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/'],
      ['GET', '/api/activity'],
      ['GET', '/api/events'],
      ['GET', '/healthz'],
    ])
  })

  it('method+path 全唯一（分域注册不得产生重复路由）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    const keys = reg.routes.map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('重复注册（同 registry 二次汇总）→ 抛错（保险丝：注册期显式炸，不等请求期）', () => {
    const reg = createRegistry()
    registerAllRoutes(reg, deps)
    expect(() => registerAllRoutes(reg, deps)).toThrow(/重复/)
  })
})

describe('分域注册（各域只注册自己的端点，域间无交叉）', () => {
  it('infra 域：/healthz、/api/events、/api/activity（不含 /）', () => {
    const reg = createRegistry()
    registerInfraRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([
      ['GET', '/api/activity'],
      ['GET', '/api/events'],
      ['GET', '/healthz'],
    ])
  })

  it('shell 域：仅 /（不含 infra 端点）', () => {
    const reg = createRegistry()
    registerShellRoutes(reg, deps)
    expect(table(reg.routes)).toEqual([['GET', '/']])
  })
})
