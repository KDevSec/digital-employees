// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AccessActions from '../src/components/access/AccessActions.vue'
import type { AccessState, AccessStatus } from '../src/api/access'

/**
 * AccessActions（I0-5 T2，设计 §3 迁移映射：demo ui.ts L29 按钮显隐布尔式照搬，语义不动）。
 * emit 由父组件（AccessView）统一调 api 动作；登录按钮是整页跳转，不经 emit。
 */

function fixture(overrides: Partial<AccessState> = {}): AccessState {
  return {
    installationId: 'inst-001',
    status: 'ACTIVE',
    authenticated: true,
    ...overrides,
  }
}

function visibleLabels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('button').map((button) => button.text())
}

const ALL_STATUSES: AccessStatus[] = [
  'NEW',
  'PENDING_REVIEW',
  'APPROVED',
  'COMPLETED',
  'ACTIVE',
  'REJECTED',
  'REVOKED',
  'ERROR',
]

/**
 * 显隐期望表（显式枚举，非公式复算——demo L29 各按钮 hidden 条件取反）：
 * 登录 !authenticated；重提 authenticated 且 NEW/REJECTED/ERROR；心跳 authenticated 且 ACTIVE；
 * 重置 authenticated 且 REJECTED/ERROR；登出 authenticated。顺序 = demo 按钮出现顺序。
 */
const EXPECTED: Record<string, string[]> = {
  // 未登录：只有登录按钮（任意状态）
  ...Object.fromEntries(
    ALL_STATUSES.map((status) => [`false:${status}`, ['登录']]),
  ),
  'true:NEW': ['重新提交接入申请', '退出登录'],
  'true:PENDING_REVIEW': ['退出登录'],
  'true:APPROVED': ['退出登录'],
  'true:COMPLETED': ['退出登录'],
  'true:ACTIVE': ['发送终端心跳', '退出登录'],
  'true:REJECTED': ['重新提交接入申请', '重置申请状态', '退出登录'],
  'true:REVOKED': ['退出登录'],
  'true:ERROR': ['重新提交接入申请', '重置申请状态', '退出登录'],
}

describe('AccessActions 显隐矩阵（2 认证态 × 8 状态全组合，demo 布尔式照搬）', () => {
  it.each(Object.entries(EXPECTED))('%s → %s', (key, expected) => {
    const [authenticated, status] = key.split(':')
    const wrapper = mount(AccessActions, {
      props: { state: fixture({ authenticated: authenticated === 'true', status: status as AccessStatus }) },
    })
    expect(visibleLabels(wrapper)).toEqual(expected)
  })
})

describe('AccessActions emit（动作事件交父组件处理）', () => {
  async function clickLabel(wrapper: ReturnType<typeof mount>, label: string): Promise<void> {
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)
    expect(button, `按钮应存在：${label}`).toBeTruthy()
    await button!.trigger('click')
  }

  it('REJECTED 登录态：重提/重置/登出各 emit 对应事件，载荷为空', async () => {
    const wrapper = mount(AccessActions, { props: { state: fixture({ status: 'REJECTED' }) } })
    await clickLabel(wrapper, '重新提交接入申请')
    await clickLabel(wrapper, '重置申请状态')
    await clickLabel(wrapper, '退出登录')
    // 按具体事件名断言（VTU 会把根元素冒泡的 DOM click 也记入 emitted()，勿断言 key 全集）
    expect(wrapper.emitted('enroll')).toHaveLength(1)
    expect(wrapper.emitted('enroll')![0]).toEqual([])
    expect(wrapper.emitted('reset')).toHaveLength(1)
    expect(wrapper.emitted('reset')![0]).toEqual([])
    expect(wrapper.emitted('logout')).toHaveLength(1)
    expect(wrapper.emitted('logout')![0]).toEqual([])
  })

  it('ACTIVE 登录态：心跳按钮 emit heartbeat', async () => {
    const wrapper = mount(AccessActions, { props: { state: fixture({ status: 'ACTIVE' }) } })
    await clickLabel(wrapper, '发送终端心跳')
    expect(wrapper.emitted('heartbeat')).toHaveLength(1)
  })

  it('登录按钮不走 emit（整页跳转是组件内行为）', async () => {
    // 桩化 location：jsdom 不真导航，未桩时点击会向 stderr 打「Not implemented: navigation」噪音
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: 'http://localhost:3000/' } })
    const wrapper = mount(AccessActions, { props: { state: fixture({ authenticated: false, status: 'NEW' }) } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('login')).toBeUndefined()
    expect(wrapper.emitted('enroll')).toBeUndefined()
  })
})

describe('AccessActions 登录按钮整页跳转', () => {
  it('点击 → window.location.href = /auth/login（OIDC 出站 302 非 SPA 导航；jsdom 不真导航，以可写 location 桩断言赋值）', async () => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: 'http://localhost:3000/' } })
    const wrapper = mount(AccessActions, { props: { state: fixture({ authenticated: false, status: 'NEW' }) } })
    await wrapper.find('button').trigger('click')
    expect(window.location.href).toBe('/auth/login')
  })
})
