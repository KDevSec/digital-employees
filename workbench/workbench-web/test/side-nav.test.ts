// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router'
import { describe, expect, it } from 'vitest'

import SideNav from '../src/components/nav/SideNav.vue'

/**
 * SideNav（I0-5 T3，F-02 导航骨架，D-6）：
 * - 可点项四枚：我的员工（/employees，默认选中）/ 底座与环境（/bases）/ 协同编排（/kanban/board，
 *   T4 泳道全景）/ 任务看板（/kanban 详情）——
 *   选中态走 router-link active（vue-router 内建），无自定义选中逻辑；
 * - 置灰项「我的群组与对话」（Q-010 能力未就绪不露死入口）：无路由（非 RouterLink）、
 *   不可点、不可聚焦、title 悬停提示「即将上线」；
 * - workflow 编辑器/审批工作台入口不渲染（D-036：仍留 L2；协同编排 ≠ workflow 编辑器——
 *   前者是任务执行全景页，后者是编排生产工具）。
 * SideNav 是叶子组件，此处挂最小 memory router 仅供 RouterLink 解析 to；
 * 路由表与真实 to 的一致性由 guard-integration / router 装配测试锁定。
 */
// '/' 记录让挂载时 install 的初始导航（memory history 初始 location '' → 归一 '/'）有落点，
// 避免 vue-router 开发警告「No match found for location with path ""」
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { name: 'EmptyRoot', render: () => null } },
    { path: '/employees', component: { name: 'EmptyE', render: () => null } },
    { path: '/bases', component: { name: 'EmptyB', render: () => null } },
    { path: '/kanban/board', component: { name: 'EmptyKB', render: () => null } },
    { path: '/kanban', component: { name: 'EmptyK', render: () => null } },
  ],
})

function mountNav() {
  return mount(SideNav, { global: { plugins: [router] } })
}

describe('SideNav 可点导航项（四枚）', () => {
  it('四枚 RouterLink 渲染且 to/文案/锚点正确（/employees /bases /kanban/board /kanban——协同编排与任务看板同级，T4 双层）', () => {
    const wrapper = mountNav()
    const links = wrapper.findAllComponents(RouterLink)
    expect(links.map((link) => link.props('to'))).toEqual(['/employees', '/bases', '/kanban/board', '/kanban'])
    expect(links.map((link) => link.text())).toEqual(['我的员工', '底座与环境', '协同编排', '任务看板'])
    // 锚点形态（可点）：href 与路由路径一致
    const anchors = wrapper.findAll('a')
    expect(anchors).toHaveLength(4)
    expect(anchors.map((anchor) => anchor.attributes('href'))).toEqual(['/employees', '/bases', '/kanban/board', '/kanban'])
  })

  it('默认选中态：位于 /employees 时「我的员工」链接带 router-link-active（router 内建选中态）', async () => {
    const wrapper = mountNav()
    await router.push('/employees')
    await flushPromises()
    const active = wrapper.findAll('a').find((anchor) => anchor.text() === '我的员工')
    expect(active).toBeDefined()
    expect(active!.classes()).toContain('router-link-active')
    // 其余两枚不带 active（互斥选中）
    for (const label of ['底座与环境', '任务看板']) {
      const item = wrapper.findAll('a').find((anchor) => anchor.text() === label)
      expect(item!.classes(), `${label} 不应带 active`).not.toContain('router-link-active')
    }
  })
})

describe('SideNav 置灰项与隐藏项', () => {
  it('「我的群组与对话」置灰：非链接（无 to/无锚点）、title 提示「即将上线」、不可聚焦（无 tabindex）', () => {
    const wrapper = mountNav()
    const item = wrapper.find('li.disabled')
    expect(item.exists()).toBe(true)
    expect(item.text()).toBe('我的群组与对话')
    expect(item.find('a').exists()).toBe(false) // 无路由：不渲染锚点
    expect(item.attributes('title')).toContain('即将上线') // hover 提示（验收口径）
    expect(item.attributes('tabindex')).toBeUndefined() // 不可聚焦
    // RouterLink 恰好四枚（置灰项不占路由；T4 增协同编排）
    expect(wrapper.findAllComponents(RouterLink)).toHaveLength(4)
  })

  it('workflow 编辑器/审批工作台入口不渲染（D-036：仍留 L2；协同编排页非编辑器，T4 起在场）', () => {
    const wrapper = mountNav()
    expect(wrapper.text()).not.toContain('workflow')
    expect(wrapper.text()).not.toContain('编辑器')
    expect(wrapper.text()).not.toContain('审批工作台')
    // 协同编排（任务执行全景页）在场且可点——与 D-036 的「编排生产工具」不同物
    expect(wrapper.text()).toContain('协同编排')
  })
})

describe('SideNav sidebar-foot 设置齿轮（D-23：设置按钮落位侧栏底部）', () => {
  it('底部存在「设置」按钮：nav-item 形态、aria-label 设置、齿轮 SVG；不占路由链接位', () => {
    const wrapper = mountNav()
    const foot = wrapper.find('.sidebar-foot')
    expect(foot.exists(), '原型 .sidebar-foot 结构应在场（nav 之后、flex 尾部对齐）').toBe(true)
    const gear = foot.find('button.nav-item')
    expect(gear.exists()).toBe(true)
    expect(gear.attributes('aria-label')).toBe('设置')
    expect(gear.text()).toBe('设置')
    expect(gear.find('svg').exists(), '齿轮 SVG（stroke 风格沿侧栏图标）').toBe(true)
    // 设置按钮不是路由链接：RouterLink 仍恰四枚（D-23：开设置浮层而非导航；T4 增协同编排）
    expect(wrapper.findAllComponents(RouterLink)).toHaveLength(4)
  })

  it('点击「设置」按钮 → emit openSettings（Layout 接线开设置浮层）', async () => {
    const wrapper = mountNav()
    await wrapper.find('.sidebar-foot button').trigger('click')
    expect(wrapper.emitted('openSettings')).toHaveLength(1)
  })
})
