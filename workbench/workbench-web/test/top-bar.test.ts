// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import Layout from '../src/components/nav/Layout.vue'
import TopBar from '../src/components/nav/TopBar.vue'
import type { AccessState } from '../src/api/access'
import { useSessionStore } from '../src/stores/session'

/**
 * TopBar（I0-5 T4，F-04 顶栏全局态，设计 §3 尾段）：
 * - 用户区：首字母圆徽 + name/email 两行；无用户「未登录」灰态（数据来自 session store）；
 * - 平台状态徽章 + 告警条：interpretPlatformStatus 消费 store.accessState（详见 platform-status.test）；
 * - 版本行：useHealthPolling（fetchHealthz + versionLineGated，2s 轮询——接入页同款逻辑的 composable 化）；
 * - 检查更新占位按钮（U 系列未落地）：点击 → 提示条「检查更新功能即将上线」；
 * - /api/state 轮询：30s 周期经 store.fetchState 刷新，挂载不立即拉取（守卫首次导航已拉过，
 *   不与 guard-integration「只拉一次」语义打架），unmount 清理定时器。
 * fetch 以 stubGlobal 顶替（沿 access-view.test.ts 手法）；假定时下用 advanceTimersByTimeAsync
 * 刷微任务（flushPromises 依赖 setTimeout 会被假定时冻结）。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  }
}

const HEALTHY = { app: 'workbench', status: 'ok', version: '0.1.0', port: 19980 }

/** ACTIVE + 新鲜心跳（构造时距墙钟 5s，90s 窗口内测试不会陈旧） */
const activeFresh: AccessState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
  authenticated: true,
  user: { name: '张三', email: 'zhangsan@corp.example' },
}

const revokedState: AccessState = {
  installationId: 'inst-001',
  status: 'REVOKED',
  authenticated: true,
  user: { name: '张三' },
}

const unauthenticatedState: AccessState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

/** 按路径分发的 fetch 桩 + 调用计数（沿 access-view.test.ts 手法） */
function stubFetch(handlers: Record<string, () => unknown>): { calls: (url: string, method: string) => number } {
  const counter = new Map<string, number>()
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    counter.set(key, (counter.get(key) ?? 0) + 1)
    const handler = handlers[url]
    if (!handler) throw new Error(`unexpected fetch: ${url}`)
    const result = handler()
    if (result instanceof Error) throw result
    return result
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls: (url: string, method: string) => counter.get(`${method} ${url}`) ?? 0,
  }
}

/**
 * 挂 TopBar 前先经真 store.fetchState 预载（守卫首次导航语义）——
 * 桩 fetch 已装好，走真实 fetchAccessState 解析路径（不做 store 层 mock）。
 */
async function mountTopBar(
  handlers: Record<string, () => unknown>,
): Promise<{ wrapper: VueWrapper; stub: { calls: (url: string, method: string) => number } }> {
  const stub = stubFetch(handlers)
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSessionStore()
  await store.fetchState()
  const wrapper = mount(TopBar, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, stub }
}

let active: VueWrapper | undefined

afterEach(() => {
  active?.unmount()
  active = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('TopBar 平台状态徽章与告警条（interpretPlatformStatus 消费 store.accessState）', () => {
  it('ACTIVE 新鲜心跳 → 绿徽章「平台已连接」，无告警条；版本行健康态展示 v0.1.0', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    const badge = wrapper.find('.platform-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('平台已连接')
    expect(badge.classes()).toContain('ok')
    expect(wrapper.find('.alert').exists()).toBe(false)
    expect(wrapper.text()).toContain('v0.1.0')
  })

  it('REVOKED → 红徽章 + 告警条「实例已被平台撤销，请联系管理员」', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(revokedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.find('.platform-badge').classes()).toContain('error')
    const alert = wrapper.find('.alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('实例已被平台撤销')
    expect(alert.text()).toContain('请联系管理员')
  })

  it('accessState null（/api/state 不可达归一）→ 红徽章「平台连接不可达」+ unreachable 告警条', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => new Error('network down'),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.find('.platform-badge').text()).toBe('平台连接不可达')
    const alert = wrapper.find('.alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('平台连接不可达')
    expect(alert.text()).toContain('不可用')
  })

  it('ACTIVE 但心跳陈旧（>90s）→ 黄徽章「心跳超时」，无告警条（stale 不出告警）', async () => {
    const stale: AccessState = { ...activeFresh, lastHeartbeatAt: new Date(Date.now() - 300_000).toISOString() }
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(stale),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.find('.platform-badge').text()).toBe('心跳超时')
    expect(wrapper.find('.platform-badge').classes()).toContain('warn')
    expect(wrapper.find('.alert').exists()).toBe(false)
  })

  it('未激活各态（NEW）→ 灰徽章「未激活」，无告警条（中性不告警）', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.find('.platform-badge').text()).toBe('未激活')
    expect(wrapper.find('.platform-badge').classes()).toContain('neutral')
    expect(wrapper.find('.alert').exists()).toBe(false)
  })
})

describe('TopBar 用户区（session store 的 accessState.user）', () => {
  it('user 带 name+email → 首字母圆徽（首字符）+ name 行 + email 行', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    const avatar = wrapper.find('.avatar')
    expect(avatar.exists()).toBe(true)
    expect(avatar.text()).toBe('张')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('zhangsan@corp.example')
  })

  it('email 缺失 → name 行渲染、email 行不渲染', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse({ ...activeFresh, user: { name: '李四' } }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.text()).toContain('李四')
    expect(wrapper.find('small').exists()).toBe(false)
  })

  it('name 缺失 → preferred_username 兜底（圆徽取其首字符）', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse({ ...activeFresh, user: { preferred_username: 'wangwu' } }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.find('.avatar').text()).toBe('w')
    expect(wrapper.text()).toContain('wangwu')
  })

  it('无用户（未登录/不可达归一 null）→ 「未登录」灰态，无圆徽', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.text()).toContain('未登录')
    expect(wrapper.find('.avatar').exists()).toBe(false)
  })
})

describe('TopBar 版本行与检查更新占位', () => {
  it('版本行非健康态（healthz 失败/形状不对）→「版本未知」（沿 health 先例健康门控语义）', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => new Error('network down'),
    })
    active = wrapper
    expect(wrapper.text()).toContain('版本未知')
    expect(wrapper.text()).not.toContain('v0.1.0')
  })

  it('检查更新占位按钮：点击 → 提示条「检查更新功能即将上线」（U 系列未落地，占位语义）', async () => {
    const { wrapper } = await mountTopBar({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    active = wrapper
    expect(wrapper.text()).not.toContain('检查更新功能即将上线')
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === '检查更新')
    expect(button, '检查更新按钮应存在').toBeTruthy()
    await button!.trigger('click')
    expect(wrapper.text()).toContain('检查更新功能即将上线')
    // 占位语义：不发起任何网络请求（无 /api/update 之类的新端点）
    expect(wrapper.findAll('button').filter((candidate) => candidate.text() === '检查更新')).toHaveLength(1)
  })
})

describe('TopBar /api/state 轮询（30s 周期）与生命周期清理', () => {
  it('挂载不立即拉取（守卫已保证 loaded）；30s 周期经 fetchState 再次拉取；unmount 停止', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState() // 守卫首次拉取语义：1 次
    const wrapper = mount(TopBar, { global: { plugins: [pinia] } })
    await vi.advanceTimersByTimeAsync(0)
    expect(stub.calls('/api/state', 'GET')).toBe(1) // 挂载零拉取（不与守卫重复）
    expect(stub.calls('/healthz', 'GET')).toBe(1) // 健康轮询挂载即拉（接入页同款）

    await vi.advanceTimersByTimeAsync(30_000)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // 30s 周期再次拉取
    await vi.advanceTimersByTimeAsync(30_000)
    expect(stub.calls('/api/state', 'GET')).toBe(3)

    const healthzBeforeUnmount = stub.calls('/healthz', 'GET')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(stub.calls('/api/state', 'GET')).toBe(3) // /api/state 轮询已停
    expect(stub.calls('/healthz', 'GET')).toBe(healthzBeforeUnmount) // 健康轮询同步清理
  })

  it('轮询拉到 REVOKED → 徽章与告警条随 store 更新翻红（accessState 响应性）', async () => {
    let stateCalls = 0
    const stub = stubFetch({
      '/api/state': () => {
        stateCalls += 1
        return jsonResponse(stateCalls === 1 ? activeFresh : revokedState)
      },
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState()
    const wrapper = mount(TopBar, { global: { plugins: [pinia] } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.platform-badge').text()).toBe('平台已连接')
    expect(wrapper.find('.alert').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(stub.calls('/api/state', 'GET')).toBe(2)
    expect(wrapper.find('.platform-badge').text()).toBe('实例已被平台撤销')
    expect(wrapper.find('.alert').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('Layout 集成：顶栏槽位挂 TopBar（I0-5 T4 组装）', () => {
  it('Layout 渲染 TopBar（平台状态徽章 + 检查更新按钮在场）', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState()
    expect(stub.calls('/api/state', 'GET')).toBe(1)
    // 沿 side-nav.test.ts 手法：最小 memory router，四路径齐全避免 RouterLink 无匹配告警
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { name: 'EmptyRoot', render: () => null } },
        { path: '/employees', component: { name: 'EmptyE', render: () => null } },
        { path: '/bases', component: { name: 'EmptyB', render: () => null } },
        { path: '/kanban', component: { name: 'EmptyK', render: () => null } },
      ],
    })
    const wrapper = mount(Layout, { global: { plugins: [router, pinia] } })
    await flushPromises()
    active = wrapper
    expect(wrapper.findComponent(TopBar).exists()).toBe(true)
    expect(wrapper.text()).toContain('平台已连接')
    expect(wrapper.text()).toContain('检查更新')
    expect(wrapper.text()).toContain('张三') // 用户区经 store 渲染
  })
})
