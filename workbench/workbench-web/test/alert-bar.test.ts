// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import AlertBar from '../src/components/nav/AlertBar.vue'
import type { AccessState } from '../src/api/access'
import { useSessionStore } from '../src/stores/session'

/**
 * AlertBar（I0-5 T10，D-25：平台告警条独立——TopBar 退役后从其抽出）：
 * unreachable/revoked 两态渲染全宽红条常驻（D-032 提示而非降级；常驻可见性不藏进设置浮层），
 * ok/inactive/stale 零渲染（正常态零占位）。
 * 组件消费 session store 的 accessState（不轮询，数据随 Layout 级 store 流动）——测试直接
 * 置 store state 驱动五档；五档判定矩阵（interpretPlatformStatus/alertBanner 纯函数）已在
 * platform-status.test 覆盖，此处锚定组件消费链与渲染/零渲染边界。
 */

/** ACTIVE + 新鲜心跳（构造时距墙钟 5s，90s 窗口内测试不会陈旧） */
const activeFresh: AccessState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
  authenticated: true,
  user: { name: 'Test User' },
}

const inactiveState: AccessState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

/** 直接置 store.accessState 驱动（组件只读 store，无路由/网络依赖） */
function mountAlertBar(state: AccessState | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSessionStore()
  store.accessState = state
  return mount(AlertBar, { global: { plugins: [pinia] } })
}

describe('AlertBar 告警两态渲染（D-25 常驻告警，不藏进浮层）', () => {
  it('unreachable（accessState null，/api/state 不可达归一）→ 红条「平台连接不可达：功能暂时不可用」', () => {
    const wrapper = mountAlertBar(null)
    const bar = wrapper.find('.alert-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('role')).toBe('alert')
    expect(bar.text()).toContain('平台连接不可达')
    expect(bar.text()).toContain('不可用')
    expect(bar.text()).toContain('正在重试')
  })

  it('revoked（REVOKED）→ 红条「实例已被平台撤销，请联系管理员」', () => {
    const wrapper = mountAlertBar({ ...activeFresh, status: 'REVOKED' })
    const bar = wrapper.find('.alert-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('实例已被平台撤销')
    expect(bar.text()).toContain('请联系管理员')
  })
})

describe('AlertBar 正常/中性/黄档态零渲染（DOM 无告警条节点，零占位）', () => {
  // 注：v-if 假值时组件根是注释占位节点（Comment 无 querySelector），零渲染断言走 VTU
  // find().exists() —— 与「querySelector 为空」同一语义（渲染 DOM 中查不到 .alert-bar）。
  it('ok（ACTIVE 新鲜心跳）→ 不渲染告警条', () => {
    const wrapper = mountAlertBar(activeFresh)
    expect(wrapper.find('.alert-bar').exists()).toBe(false)
  })

  it('inactive（NEW 未激活，中性不告警）→ 不渲染告警条', () => {
    const wrapper = mountAlertBar(inactiveState)
    expect(wrapper.find('.alert-bar').exists()).toBe(false)
  })

  it('stale（ACTIVE 心跳陈旧 >90s，黄档不告警）→ 不渲染告警条', () => {
    const stale: AccessState = {
      ...activeFresh,
      lastHeartbeatAt: new Date(Date.now() - 300_000).toISOString(),
    }
    const wrapper = mountAlertBar(stale)
    expect(wrapper.find('.alert-bar').exists()).toBe(false)
  })
})
