// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../src/api/employees', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/employees')>()
  return {
    ...actual,
    fetchEmployees: vi.fn(),
  }
})

import { fetchEmployees } from '../src/api/employees'
import type { EmployeeCard } from '../src/api/employees'
import EmployeesView from '../src/views/EmployeesView.vue'

/**
 * EmployeesView 花名册页（L1 员工新建线 Task 17）：
 * - page-head：h1「我的员工」+ 工具行「＋新建员工」按钮 → /employees/new
 * - 卡片 grid：每张卡 = 头像 emoji + 岗位名 + id + kind tag（flow-owner 蓝/callee 紫）+ version + brief 两行截断
 * - 空态引导卡：items 为空时显示「＋新建员工」+ 一句话「从模板快速创建你的数字员工」
 * - 数据：onMounted 调 fetchEmployees()
 *
 * 视觉沿 tokens.css + 原型类名风格（card grid 同 tpl-grid 形态）。
 */

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/employees', component: EmployeesView },
      { path: '/employees/new', component: { template: '<div id="wizard-stub"/>' } },
    ],
  })
}

const THREE_EMPLOYEES: EmployeeCard[] = [
  { id: 'dev-engineer', display: '开发工程师', brief: '承接需求完成代码实现', avatar: '🧑‍💻', kind: 'flow-owner', version: '0.1.0' },
  { id: 'reviewer-expert', display: '评审专家', brief: '被 gate 发函的结构化评审', avatar: '⚖️', kind: 'callee', version: '0.1.0' },
  { id: 'sys-engineer', display: '系统工程师', brief: '总体设计与技术选型', avatar: '🧑‍🔬', kind: 'flow-owner', version: '0.1.0' },
]

describe('EmployeesView 花名册页', () => {
  beforeEach(() => {
    vi.mocked(fetchEmployees).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('page-head：h1「我的员工」+ 工具行「＋新建员工」按钮在位', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: THREE_EMPLOYEES, invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    const wrapper = mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('我的员工')
    const btn = wrapper.find('button.new-emp-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('新建员工')
  })

  it('3 员工 → 渲染 3 张卡片（头像/岗位名/kind tag/version/brief）', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: THREE_EMPLOYEES, invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    const wrapper = mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()

    const cards = wrapper.findAll('.emp-card')
    expect(cards.length).toBe(3)

    // 第一张卡：dev-engineer
    const devCard = cards.find((c) => c.text().includes('dev-engineer'))
    expect(devCard, 'dev-engineer 卡应存在').toBeTruthy()
    const devText = devCard!.text()
    expect(devText).toContain('开发工程师')
    expect(devText).toContain('🧑‍💻')
    expect(devText).toContain('flow-owner')
    expect(devText).toContain('0.1.0')
    expect(devText).toContain('承接需求完成代码实现')

    // callee 卡的 kind tag 紫色（tag-violet 类）
    const calleeCard = cards.find((c) => c.text().includes('reviewer-expert'))
    expect(calleeCard, 'reviewer-expert 卡应存在').toBeTruthy()
    expect(calleeCard!.find('.tag-violet').exists()).toBe(true)
    // flow-owner 卡的 kind tag 蓝色（tag-blue 类）
    expect(devCard!.find('.tag-blue').exists()).toBe(true)
  })

  it('空态：items 为空 → 显示引导卡「＋新建员工」+「从模板快速创建你的数字员工」', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: [], invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    const wrapper = mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()

    // 无员工卡
    expect(wrapper.findAll('.emp-card').length).toBe(0)
    // 空态引导卡在位
    const emptyCard = wrapper.find('.empty-card')
    expect(emptyCard.exists()).toBe(true)
    expect(emptyCard.text()).toContain('新建员工')
    expect(emptyCard.text()).toContain('从模板快速创建你的数字员工')
  })

  it('工具行「新建员工」按钮点击 → router.push 到 /employees/new', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: THREE_EMPLOYEES, invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    const wrapper = mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('button.new-emp-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/employees/new')
  })

  it('空态引导卡点击 → 同样跳 /employees/new', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: [], invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    const wrapper = mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('.empty-card').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/employees/new')
  })

  it('onMounted 调 fetchEmployees 一次', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: THREE_EMPLOYEES, invalid: [] })
    const router = makeRouter()
    router.push('/employees')
    await router.isReady()
    mount(EmployeesView, { global: { plugins: [router] } })
    await flushPromises()
    expect(fetchEmployees).toHaveBeenCalledTimes(1)
  })
})
