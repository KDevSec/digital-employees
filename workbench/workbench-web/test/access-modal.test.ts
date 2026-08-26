// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'

import AccessModal from '../src/components/access/AccessModal.vue'
import type { AccessState } from '../src/api/access'
import { useSessionStore } from '../src/stores/session'

/**
 * AccessModal（I0-5 T11，设计 D-26：用户验收反馈「接入与平台设置页面应该是弹窗，或带
 * 侧边栏的页面，而不是单独页面无法返回」——原 RouterLink 跳 '/' 全屏路由，ACTIVE 用户
 * 进入后无侧栏无返回，动线断层）：
 * - 形态：fixed 全屏 mask（原型 modal-mask rgba(15,23,42,.45)）+ 居中白卡（~680px /
 *   max-width 92vw / 原型 modal 阴影），常驻挂载于 Layout（v-model:open 受控沿
 *   SettingsPanel 形态；open=false 时 DOM 零渲染）；
 * - 卡体三件套（组件零改动复用）：AccessStatusCard + PlatformConfigCard + AccessActions
 *   竖排——数据流与 AccessView 登录态一致：session store 的 accessState 驱动（props 直传，
 *   弹窗不自拉 /api/state；PlatformConfigCard 自拉 /api/config/platform）；
 * - 关闭三径：Esc（document keydown）/ mask 点击（target===mask 判定，点卡内不关）/
 *   卡头 X 钮；关闭即回原业务页（URL 不动，上下文不丢）；
 * - 动作：enroll/heartbeat/reset 走 AccessView run() 简版（调动作 → 成功刷 store →
 *   不整页跳转，文案沿 demo messageNode 语义）；logout 走 SettingsPanel 同款链路
 *   （logoutAction → fetchState → 关 modal → router.push('/')）。
 * fetch 以 stubGlobal 顶替（沿 settings-panel.test.ts 手法）；挂载前经真 store.fetchState
 * 预载（守卫首次导航语义——弹窗数据源 = store 而非自拉）。
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
const PLATFORM_CONFIG = { baseUrl: 'http://192.168.1.5:18000' }

/** ACTIVE + Test User（settings-panel.test 同款 fixture；心跳 5s 前新鲜） */
const activeState: AccessState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
  authenticated: true,
  user: { name: 'Test User', email: 'test@example.com' },
}

const inactiveState: AccessState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

/** 按路径分派的 fetch 桩 + 调用计数（沿 settings-panel.test.ts 手法） */
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

/** 最小 memory router（弹窗 logout 链路 router.push('/') 需真 router 注入；四路径齐全） */
function createMinimalRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { name: 'EmptyRoot', render: () => null } },
      { path: '/employees', component: { name: 'EmptyE', render: () => null } },
      { path: '/bases', component: { name: 'EmptyB', render: () => null } },
      { path: '/kanban', component: { name: 'EmptyK', render: () => null } },
    ],
  })
}

/** 挂弹窗前先经真 store.fetchState 预载（守卫首次导航语义）——弹窗不自拉，store 即数据源 */
async function mountModal(
  handlers: Record<string, () => unknown>,
  options: { open?: boolean; push?: string } = {},
): Promise<{ wrapper: VueWrapper; stub: { calls: (url: string, method: string) => number }; router: Router }> {
  const stub = stubFetch(handlers)
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSessionStore()
  await store.fetchState()
  const router = createMinimalRouter()
  const wrapper = mount(AccessModal, {
    props: { open: options.open ?? true },
    global: { plugins: [pinia, router] },
  })
  await flushPromises()
  if (options.push) {
    // memory history 初始恒为 '/'（vue-router 4.6.4）——「停当前页不跳转」断言需先离港
    await router.push(options.push)
    await flushPromises()
  }
  active = wrapper
  return { wrapper, stub, router }
}

let active: VueWrapper | undefined

afterEach(() => {
  active?.unmount()
  active = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AccessModal 挂载与渲染（D-26：三件套零改动复用，store 驱动）', () => {
  it('open=true + store 预载 ACTIVE → mask 在场 + 卡头（标题/X 钮）+ 三组件内容全渲染', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    // mask + 居中卡（dialog 语义）
    expect(wrapper.find('.access-modal-mask').exists()).toBe(true)
    const modal = wrapper.find('.access-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.attributes('role')).toBe('dialog')
    // 卡头：标题 + 关闭 X 钮
    expect(wrapper.find('.modal-title').text()).toBe('接入与平台设置')
    expect(wrapper.find('button.modal-close').exists()).toBe(true)
    // AccessStatusCard：ACTIVE 状态行「已激活」+ 状态卡数据行
    expect(wrapper.text()).toContain('已激活')
    expect(wrapper.text()).toContain('inst-001')
    expect(wrapper.text()).toContain('wb-7')
    expect(wrapper.text()).toContain('Test User')
    // PlatformConfigCard：「平台连接」标题 + 编辑 input + 当前地址（组件自拉 config）
    expect(wrapper.text()).toContain('平台连接')
    expect(wrapper.find('.access-modal input').exists()).toBe(true)
    expect(wrapper.text()).toContain('http://192.168.1.5:18000')
    // AccessActions：ACTIVE fixture → 心跳 + 登出在场；登录/重提/重置不显示（demo 显隐布尔式）
    const buttonTexts = wrapper.findAll('.access-modal button').map((button) => button.text())
    expect(buttonTexts).toContain('发送终端心跳')
    expect(buttonTexts).toContain('退出登录')
    expect(buttonTexts).not.toContain('登录')
    expect(buttonTexts).not.toContain('重新提交接入申请')
    expect(buttonTexts).not.toContain('重置申请状态')
  })

  it('open=false → 弹窗 DOM 零渲染（v-if 受控；配置卡随 v-if 不挂载不拉取）', async () => {
    const { wrapper, stub } = await mountModal(
      {
        '/api/state': () => jsonResponse(activeState),
        '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
      },
      { open: false },
    )
    expect(wrapper.find('.access-modal-mask').exists()).toBe(false)
    expect(wrapper.find('.access-modal').exists()).toBe(false)
    // 三件套随 v-if 不存在：配置卡未挂载（无 GET /api/config/platform）
    expect(stub.calls('/api/config/platform', 'GET')).toBe(0)
  })
})

describe('AccessModal 关闭三径（Esc / mask 外点 / X——沿 SettingsPanel 手法）', () => {
  it('Esc → emit update:open false', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('点 mask（卡外）→ emit update:open false（target===mask 判定）', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    await wrapper.find('.access-modal-mask').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('点卡片内部 → 不关闭（卡体/卡内标题点击不触发 mask 外点判定）', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    await wrapper.find('.access-modal').trigger('click') // 卡体自身（冒泡到 mask，target 非 mask）
    await wrapper.find('.modal-title').trigger('click') // 卡内标题
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined() // 未发出关闭
    expect(wrapper.find('.access-modal-mask').exists()).toBe(true)
  })

  it('点 X 关闭钮 → emit update:open false', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    await wrapper.find('button.modal-close').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })
})

describe('AccessModal 动作处理（AccessActions emit → api 动作 → store 刷新，D-26 简版）', () => {
  it('心跳成功 → POST /api/heartbeat + 刷 store 重拉 /api/state + 「操作成功」文案；停当前页不整页跳转', async () => {
    let stateCalls = 0
    const { wrapper, stub, router } = await mountModal(
      {
        // 预载 1 次 ACTIVE；心跳成功后重拉 → 新心跳时间戳（状态卡随 store 更新）
        '/api/state': () => {
          stateCalls += 1
          return jsonResponse(
            stateCalls === 1 ? activeState : { ...activeState, lastHeartbeatAt: '2026-08-26T12:00:00Z' },
          )
        },
        '/api/heartbeat': () => jsonResponse({ status: 'ok' }),
        '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
      },
      { push: '/employees' },
    )
    expect(router.currentRoute.value.path).toBe('/employees')
    expect(wrapper.text()).not.toContain('操作成功')
    const heartbeat = wrapper.findAll('.access-modal button').find((button) => button.text() === '发送终端心跳')
    expect(heartbeat, '心跳按钮应存在').toBeTruthy()
    await heartbeat!.trigger('click')
    await flushPromises()
    expect(stub.calls('/api/heartbeat', 'POST')).toBe(1)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // 动作成功后刷 store
    expect(wrapper.text()).toContain('操作成功')
    expect(wrapper.text()).toContain('2026-08-26T12:00:00Z') // 状态卡已翻新心跳
    // 不整页跳转：停当前业务页，弹窗保持开
    expect(router.currentRoute.value.path).toBe('/employees')
    expect(wrapper.find('.access-modal-mask').exists()).toBe(true)
  })

  it('动作失败 → 服务端错误文案透传（demo call() throw 语义），不刷 store', async () => {
    const { wrapper, stub } = await mountModal({
      '/api/state': () => jsonResponse(activeState),
      '/api/heartbeat': () =>
        jsonResponse({ error: { code: 'PLATFORM_DOWN', message: '平台连接失败' } }, { ok: false, status: 502, statusText: 'Bad Gateway' }),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    const heartbeat = wrapper.findAll('.access-modal button').find((button) => button.text() === '发送终端心跳')
    expect(heartbeat, '心跳按钮应存在').toBeTruthy()
    await heartbeat!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('平台连接失败')
    expect(wrapper.text()).not.toContain('处理中…')
    expect(stub.calls('/api/state', 'GET')).toBe(1) // 失败不刷新
  })

  it('退出登录（SettingsPanel 同款链路）→ POST /api/logout → GET /api/state 刷未登录态 → 关 modal → 回 /', async () => {
    let stateCalls = 0
    const { wrapper, stub, router } = await mountModal(
      {
        // 预载 1 次 ACTIVE；退出动作后再拉 → 未登录态
        '/api/state': () => {
          stateCalls += 1
          return jsonResponse(stateCalls === 1 ? activeState : inactiveState)
        },
        '/api/logout': () => jsonResponse({ status: 'ok' }),
        '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
      },
      { push: '/employees' },
    )
    expect(router.currentRoute.value.path).toBe('/employees')
    const logout = wrapper.findAll('.access-modal button').find((button) => button.text() === '退出登录')
    expect(logout, '退出登录按钮应存在').toBeTruthy()
    await logout!.trigger('click')
    await flushPromises()
    expect(stub.calls('/api/logout', 'POST')).toBe(1)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // 预载 1 + 退出后 fetchState 1
    expect(router.currentRoute.value.path).toBe('/') // 编程导航回 '/'（守卫按未登录分流回登录卡）
    expect(wrapper.emitted('update:open')).toContainEqual([false]) // 关 modal
  })
})

describe('AccessModal store 数据流（AccessView 登录态一致：accessState 驱动三组件）', () => {
  it('store 为 null（服务不可达）→ 三件套不渲染，降级提示行（props 非空约束的守门分支）', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => new Error('network down'),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    expect(wrapper.find('.access-modal-mask').exists()).toBe(true)
    expect(wrapper.text()).toContain('服务不可达')
    expect(wrapper.find('.access-modal button.modal-close').exists()).toBe(true) // 卡头仍可关闭
    expect(wrapper.text()).not.toContain('已激活')
  })

  it('未登录态 fixture → AccessActions 显示「登录」（弹窗不自拉，store 有啥显啥）', async () => {
    const { wrapper } = await mountModal({
      '/api/state': () => jsonResponse(inactiveState),
      '/api/config/platform': () => jsonResponse(PLATFORM_CONFIG),
    })
    const buttonTexts = wrapper.findAll('.access-modal button').map((button) => button.text())
    expect(buttonTexts).toContain('登录')
    expect(buttonTexts).not.toContain('发送终端心跳')
    expect(wrapper.text()).toContain('请先登录') // AccessStatusCard 未登录提示块
  })
})
