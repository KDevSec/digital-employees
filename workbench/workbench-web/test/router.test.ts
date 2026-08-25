import { describe, expect, it, vi } from 'vitest'

/**
 * web 路由分域汇总约定（I0-5 T1，设计 D-4：与 service 侧 src/server/routes/<domain>.ts 同构）。
 * routes/<domain>.ts 每域导出 RouteRecordRaw[]，router/index.ts 静态汇总一行一域。
 *
 * 测试环境说明（node 纯逻辑，无 jsdom——D-10 组件测试环境 T2 才引入）：
 * - router/index.ts 顶层 createWebHistory() 依赖 window.history，node 环境不可用，
 *   以 createMemoryHistory 顶替——本测试只验证「路由表来自域汇总」的装配事实，不测 history 策略；
 * - .vue 组件不经组件渲染（本测试只验路由装配结构），以桩组件拦截 import——
 *   桩目标随 T2 换挂为 AccessView。
 */
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: actual.createMemoryHistory }
})

vi.mock('../src/views/AccessView.vue', () => ({ default: { name: 'AccessViewStub' } }))

import { router } from '../src/router'
import { accessRoutes } from '../src/router/routes/access'

describe('web 路由分域汇总（router/routes/access.ts + router/index.ts）', () => {
  it('access 域文件导出路由数组包含 path "/"（I0-5 T2 起挂 F-03 AccessView）', () => {
    expect(accessRoutes.map((r) => r.path)).toContain('/')
  })

  it('router 实例的路由表来自域汇总（域导出的每条记录按引用出现在实例路由表中）', () => {
    expect(router.options.routes).toHaveLength(accessRoutes.length)
    for (const record of accessRoutes) {
      expect(router.options.routes).toContain(record)
    }
  })

  it('router 实例可解析 access 域路由（resolve("/") 命中且 matched 路径为 "/"）', () => {
    const resolved = router.resolve('/')
    expect(resolved.matched).toHaveLength(1)
    expect(resolved.matched[0]?.path).toBe('/')
  })
})
