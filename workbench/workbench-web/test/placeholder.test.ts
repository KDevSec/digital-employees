// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { basesRoutes } from '../src/router/routes/bases'
import BasesView from '../src/views/BasesView.vue'

/**
 * bases 域真页接线路由（L2 安装线填充 I0-5 预留版面；Placeholder 三域全部退役，本文件是终页覆盖）。
 * 域替换史：employees -> L1 Task 17 EmployeesView；kanban -> L5 看板线 KanbanView；
 * bases -> L2（D-062 档位配置化）BasesView。
 * 页面行为细节在 bases-view.test.ts；本文件只锚路由-视图绑定与标题在场。
 */
describe('bases 域：路由挂 BasesView 真页（Placeholder 全退役）', () => {
  it('路由 component = BasesView', () => {
    expect(basesRoutes[0].component).toBe(BasesView)
  })

  it('页面头标题「底座与环境」在场（路由间的蝴蝶效应锚）', async () => {
    const wrapper = mount(BasesView)
    expect(wrapper.find('h1').text()).toBe('底座与环境')
  })
})
