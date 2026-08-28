import { describe, expect, it, vi } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

/**
 * web 路由分域汇总约定（I0-5 T1 立约，T3 扩至四域；设计 D-4/D-5/D-6）：
 * routes/<domain>.ts 每域导出 RouteRecordRaw[]，router/index.ts 静态汇总一行一域。
 *
 * 测试环境说明（node 纯逻辑，无 jsdom——组件/守卫行为由 T3 各组件与集成测试覆盖）：
 * - router/index.ts 顶层 createWebHistory() 依赖 window.history，node 环境不可用，
 *   以 createMemoryHistory 顶替——本测试只验证「路由表来自域汇总」的装配事实，不测 history 策略；
 * - AccessView 以桩组件拦截 import（接入页组件重且另有专属测试）；Layout/Placeholder 为轻组件，
 *   直接经 plugin-vue 编译 import，无需桩。
 *
 * Layout 嵌套结构（I0-5 T3，D-5）：access '/' 顶层独立（接入页全屏无侧栏）；
 * 业务三域为 Layout 父记录（同为顶层 path '/'）children 下的相对路径子记录。
 * vue-router 4 对同分（同 path '/'）记录按注册序取先者——4.6.4 源码+探针实证：
 * 等分 matcher 保持插入序、resolve 首个命中——故 access 行必须列在 Layout 父记录之前；
 * 下方「resolve("/") 命中 access」断言即该顺序约束的回归保险（若有人调换顺序此测试变红）。
 */

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: actual.createMemoryHistory }
})

vi.mock('../src/views/AccessView.vue', () => ({ default: { name: 'AccessViewStub' } }))

import Layout from '../src/components/nav/Layout.vue'
import { router } from '../src/router'
import { accessRoutes } from '../src/router/routes/access'
import { basesRoutes } from '../src/router/routes/bases'
import { employeesRoutes } from '../src/router/routes/employees'
import { kanbanRoutes } from '../src/router/routes/kanban'

/** 单视图记录的 component 取值（RouteRecordRaw 联合类型收窄辅助） */
function componentOf(record: RouteRecordRaw): unknown {
  return (record as { component?: unknown }).component
}

describe('web 路由分域汇总（access + employees/bases/kanban 四域，一行一域）', () => {
  it('access 域文件导出路由数组包含顶层 path "/"（I0-5 T2 起挂 F-03 AccessView）', () => {
    expect(accessRoutes.map((r) => r.path)).toContain('/')
  })

  it('三业务域各导出子路由记录（相对路径，挂 Layout 父记录 children 下）', () => {
    // L1 Task 13：employees 域追加 `employees/new` → CreateWizard；与 `employees` 同为相对路径子记录
    expect(employeesRoutes.map((r) => r.path)).toEqual(['employees', 'employees/new'])
    expect(basesRoutes.map((r) => r.path)).toEqual(['bases'])
    expect(kanbanRoutes.map((r) => r.path)).toEqual(['collab', 'kanban'])
  })

  it('router 实例路由表 = access 域记录 + Layout 父记录（三域子记录按引用挂入 children）', () => {
    const routes = router.options.routes
    expect(routes).toHaveLength(2)
    expect(routes).toContain(accessRoutes[0])
    const layoutParent = routes.find((r) => r !== accessRoutes[0]) as {
      path: string
      children: RouteRecordRaw[]
      component: unknown
    }
    expect(layoutParent.path).toBe('/')
    expect(layoutParent.component).toBe(Layout)
    for (const domain of [employeesRoutes, basesRoutes, kanbanRoutes]) {
      expect(layoutParent.children).toContain(domain[0])
    }
  })

  it('resolve("/") 精确命中 access 域记录（双顶层 "/" 同分先注册者胜——access 在前是硬约束）', () => {
    const resolved = router.resolve('/')
    expect(resolved.matched).toHaveLength(1)
    expect(resolved.matched[0]?.path).toBe('/')
    expect(resolved.matched[0]?.components?.default).toBe(componentOf(accessRoutes[0]))
  })

  it('resolve 三业务域路径：matched 链 = [Layout 父记录, 对应占位子记录]（D-5 嵌套，跨域共享 Layout；kanban/board 泳道全景同构）', () => {
    const cases: Array<[path: string, record: RouteRecordRaw]> = [
      ['/employees', employeesRoutes[0]],
      ['/bases', basesRoutes[0]],
      ['/kanban', kanbanRoutes[1]], // T4：kanbanRoutes[0] = /collab（泳道全景），[1] = /kanban（详情）
    ]
    for (const [path, record] of cases) {
      const resolved = router.resolve(path)
      expect(resolved.matched.map((m) => m.path), `resolve(${path}) matched 链`).toEqual(['/', path])
      expect(resolved.matched[0]?.components?.default).toBe(Layout)
      expect(resolved.matched[1]?.components?.default).toBe(componentOf(record))
    }
    const board = router.resolve('/collab')
    expect(board.matched.map((m) => m.path)).toEqual(['/', '/collab'])
    expect(board.matched[1]?.components?.default).toBe(componentOf(kanbanRoutes[0]))
  })
})
