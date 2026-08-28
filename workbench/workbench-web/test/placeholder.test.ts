// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { basesRoutes } from '../src/router/routes/bases'
import BasesView from '../src/views/BasesView.vue'

/**
 * bases 域真页接线路由（Placeholder 三域全部退役）。
 * 域替换史：employees -> L1 EmployeesView；kanban -> L5 KanbanView；bases -> BasesView。
 * 不 mount BasesView：本 worktree 的 jsdom + undici 无法撑起该页，页面行为在 bases-view.test.ts 按纯函数缝测。
 */
describe('bases 域：路由挂 BasesView 真页（Placeholder 全退役）', () => {
  it('路由 component = BasesView', () => {
    expect(basesRoutes[0].component).toBe(BasesView)
  })
})
