// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'

import Layout from '../src/components/nav/Layout.vue'
import SettingsPanel from '../src/components/nav/SettingsPanel.vue'
import type { AccessState } from '../src/api/access'
import { useSessionStore } from '../src/stores/session'

/**
 * SettingsPanel（I0-5 T10，D-24：TopBar 退役，内容全迁设置浮层）：
 * - 形态：侧栏底部向上弹出的固定定位浮层（left:78px 侧栏右侧 / bottom:16px / 280px 白卡），
 *   常驻挂载于 Layout（v-model:open 受控，open=false 时浮层 DOM 零渲染）；
 * - 三分组（组间 g100 分隔线）：
 *   ① 用户组：首字母圆徽（avatar av-blue）+ name/email 两行；无用户「未登录」灰态；
 *   ② 状态组：平台状态 tag（interpretPlatformStatus 消费 store.accessState，沿 TopBar
 *      tag 体系映射 ok→tag-green/warn→tag-amber/error→tag-red/neutral→tag-gray）
 *      + 版本行（useHealthPolling 数据源迁此——healthz fetch mock 驱动）；
 *   ③ 动作组：「检查更新」占位（点击提示「检查更新功能即将上线」）+「接入与平台设置」
 *      （D-26：RouterLink 跳 '/' 退役——ACTIVE 用户全屏路由无侧栏无返回动线断层；改
 *      button emit openAccess 交 Layout 开 AccessModal，关闭即回原业务页）+「退出登录」
 *      红字（logoutAction → store.fetchState → 编程导航回 '/'——D-22 语义沿 top-bar.test
 *      迁移）；
 * - 开关：外点/Esc 关闭（沿 T9 TopBar 下拉手法：document 监听 + onBeforeUnmount 清理 +
 *   contains 判定「点浮层内部不关」）；
 * - useHealthPolling 迁入：浮层组件挂载起轮询（打开时数据新鲜），卸载清理；
 *   /api/state 不轮询（TopBar 的 30s 周期刷新随其退役，数据更新点 = 守卫首拉 + 退出刷新）。
 * fetch 以 stubGlobal 顶替（沿 top-bar.test.ts 手法）；假定时下用 advanceTimersByTimeAsync
 * 刷微任务（flushPromises 依赖 setTimeout 会被假定时冻结）。
 * Layout 组装断言（D-24/D-25）：顶部无 TopBar、告警态 AlertBar 在 main 顶部常驻。
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

/** ACTIVE + 新鲜心跳 + Test User（用户验收指令原文的展示性 claim：Test User/test@example.com） */
const activeFresh: AccessState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
  authenticated: true,
  user: { name: 'Test User', email: 'test@example.com' },
}

const revokedState: AccessState = {
  installationId: 'inst-001',
  status: 'REVOKED',
  authenticated: true,
  user: { name: 'Test User' },
}

const inactiveState: AccessState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

/** 按路径分派的 fetch 桩 + 调用计数（沿 top-bar.test.ts 手法） */
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
 * 最小 memory router（浮层含 RouterLink/useRouter，挂载需真 router 注入；四路径齐全
 * 避免 RouterLink 无匹配告警——沿 top-bar.test.ts 手法）。
 */
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

/**
 * 挂浮层前先经真 store.fetchState 预载（守卫首次导航语义）——桩 fetch 已装好，走真实
 * fetchAccessState 解析路径（不做 store 层 mock）。attachTo: document.body——外点关闭的
 * document click 监听需要真实冒泡路径（VTU 默认游离树不挂文档，trigger 的事件到不了 document）。
 */
async function mountPanel(
  handlers: Record<string, () => unknown>,
  options: { push?: string } = {},
): Promise<{ wrapper: VueWrapper; stub: { calls: (url: string, method: string) => number }; router: Router }> {
  const stub = stubFetch(handlers)
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSessionStore()
  await store.fetchState()
  const router = createMinimalRouter()
  const wrapper = mount(SettingsPanel, {
    props: { open: true },
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await flushPromises()
  if (options.push) {
    // memory history 初始恒为 '/'（vue-router 4.6.4）——从业务页跳 '/' 才可观测
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

describe('SettingsPanel 用户组（D-24 ①：TopBar 用户区迁入）', () => {
  it('ACTIVE fixture → 首字母圆徽（avatar av-blue，首字符 T）+ Test User + test@example.com 两行', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const avatar = wrapper.find('.avatar')
    expect(avatar.exists()).toBe(true)
    expect(avatar.text()).toBe('T')
    expect(avatar.classes()).toContain('av-blue')
    expect(wrapper.text()).toContain('Test User')
    expect(wrapper.text()).toContain('test@example.com')
  })

  it('email 缺失 → name 行渲染、email 行不渲染', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse({ ...activeFresh, user: { name: '李四' } }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    expect(wrapper.text()).toContain('李四')
    expect(wrapper.find('small').exists()).toBe(false)
  })

  it('name 缺失 → preferred_username 兜底（圆徽取其首字符）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse({ ...activeFresh, user: { preferred_username: 'wangwu' } }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    expect(wrapper.find('.avatar').text()).toBe('w')
    expect(wrapper.text()).toContain('wangwu')
  })

  it('未登录 fixture → 「未登录」灰态，无圆徽', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(inactiveState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    expect(wrapper.text()).toContain('未登录')
    expect(wrapper.find('.avatar').exists()).toBe(false)
  })
})

describe('SettingsPanel 状态组（D-24 ②：平台状态 tag + 版本行——useHealthPolling 迁入）', () => {
  it('ACTIVE 新鲜心跳 → tag「平台已连接」（tag-green）+ 版本行 v0.1.0（healthz 数据）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const badge = wrapper.find('.platform-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('平台已连接')
    expect(badge.classes()).toContain('tag-green')
    expect(wrapper.text()).toContain('v0.1.0')
  })

  it('healthz 失败（非健康态）→ 版本行「版本未知」，不显示 v0.1.0（沿 health 先例健康门控语义）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => new Error('network down'),
    })
    expect(wrapper.text()).toContain('版本未知')
    expect(wrapper.text()).not.toContain('v0.1.0')
  })

  it('REVOKED → tag「实例已被平台撤销」红档（tag-red）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(revokedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const badge = wrapper.find('.platform-badge')
    expect(badge.text()).toBe('实例已被平台撤销')
    expect(badge.classes()).toContain('tag-red')
  })

  it('未激活（NEW）→ tag「未激活」灰档（tag-gray）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(inactiveState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const badge = wrapper.find('.platform-badge')
    expect(badge.text()).toBe('未激活')
    expect(badge.classes()).toContain('tag-gray')
  })
})

describe('SettingsPanel 动作组（D-24 ③：D-22 两项 + 检查更新占位迁入）', () => {
  it('检查更新占位按钮：点击 → 提示「检查更新功能即将上线」，不发起任何网络请求（U 系列未落地）', async () => {
    const { wrapper, stub } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const healthzCalls = stub.calls('/healthz', 'GET')
    const stateCalls = stub.calls('/api/state', 'GET')
    expect(wrapper.text()).not.toContain('检查更新功能即将上线')
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === '检查更新')
    expect(button, '检查更新按钮应存在').toBeTruthy()
    await button!.trigger('click')
    expect(wrapper.text()).toContain('检查更新功能即将上线')
    // 占位语义：不发起任何网络请求（无 /api/update 之类的新端点）
    expect(stub.calls('/healthz', 'GET')).toBe(healthzCalls)
    expect(stub.calls('/api/state', 'GET')).toBe(stateCalls)
  })

  it('「接入与平台设置」button（D-26：RouterLink 退役）→ emit openAccess + 浮层收起，不发生路由跳转', async () => {
    const { wrapper, router } = await mountPanel(
      {
        '/api/state': () => jsonResponse(activeFresh),
        '/healthz': () => jsonResponse(HEALTHY),
      },
      { push: '/employees' },
    )
    expect(router.currentRoute.value.path).toBe('/employees')
    // D-26：第三项改 button（原 RouterLink 跳 '/' 全屏路由——ACTIVE 用户进入后无侧栏
    // 无返回，动线断层；浮层动作组内不再有锚点）
    expect(wrapper.findAll('.settings-panel a').length).toBe(0)
    const button = wrapper.findAll('.settings-panel button').find((item) => item.text() === '接入与平台设置')
    expect(button, '动作组第三项应为 button').toBeTruthy()
    await button!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('openAccess')).toContainEqual([]) // 请求 Layout 开 AccessModal
    expect(wrapper.emitted('update:open')).toContainEqual([false]) // 浮层收起
    expect(router.currentRoute.value.path).toBe('/employees') // 停当前页（弹窗承载，不整页跳转）
  })

  it('「退出登录」红字按钮 → POST /api/logout → GET /api/state 刷新未登录态 → 编程导航回 /', async () => {
    let stateCalls = 0
    const { wrapper, stub, router } = await mountPanel(
      {
        // 预载 1 次 ACTIVE（守卫首次拉取语义）；退出动作后再拉 → 未登录态
        '/api/state': () => {
          stateCalls += 1
          return jsonResponse(stateCalls === 1 ? activeFresh : inactiveState)
        },
        '/api/logout': () => jsonResponse({ status: 'ok' }),
        '/healthz': () => jsonResponse(HEALTHY),
      },
      { push: '/employees' },
    )
    expect(router.currentRoute.value.path).toBe('/employees')
    const logout = wrapper.findAll('.settings-panel button').find((item) => item.text() === '退出登录')
    expect(logout, '退出登录应为动作组内按钮').toBeTruthy()
    await logout!.trigger('click')
    await flushPromises()

    expect(stub.calls('/api/logout', 'POST')).toBe(1)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // 预载 1 + 退出后 fetchState 1
    expect(router.currentRoute.value.path).toBe('/')
    // store 已翻未登录态（退出后 fetchState 拿到未登录态，用户组自然回灰态）
    expect(wrapper.text()).toContain('未登录')
    expect(wrapper.emitted('update:open')).toContainEqual([false]) // 浮层收起
  })
})

describe('SettingsPanel 开关（props.open + 外点/Esc 关闭——沿 T9 TopBar 下拉手法）', () => {
  it('open=false → 浮层零渲染；setProps true → 三分组渲染（v-model:open 受控；常驻挂载下轮询照常）', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState()
    const wrapper = mount(SettingsPanel, { props: { open: false }, global: { plugins: [pinia, createMinimalRouter()] } })
    active = wrapper
    await flushPromises()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    // 常驻挂载语义：open=false 组件仍在树上，useHealthPolling 照常起轮询（浮层打开即见新鲜版本行）
    expect(stub.calls('/healthz', 'GET')).toBe(1)

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('Test User')
  })

  it('外点（document 冒泡）→ emit update:open false（浮层收起）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    expect(wrapper.find('.settings-panel').exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('点浮层内部 → 不关闭（contains 判定，浮层内交互不被外点误伤）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    await wrapper.find('.settings-panel .user-group').trigger('click')
    await wrapper.find('.settings-panel button').trigger('click') // 动作组按钮点击同样不关
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined() // 未发出关闭
    expect(wrapper.find('.settings-panel').exists()).toBe(true)
  })

  it('Esc 键 → emit update:open false（浮层收起）', async () => {
    const { wrapper } = await mountPanel({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    expect(wrapper.find('.settings-panel').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })
})

describe('SettingsPanel useHealthPolling 迁入（挂载即拉 + 2s 轮询 + 卸载清理）', () => {
  it('挂载即拉 healthz + 2s 周期轮询；unmount 清理定时器；/api/state 30s 周期刷新（T10 单审裁决恢复——D-032 运行中告警新鲜度）', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState() // 守卫首次拉取语义：1 次
    const wrapper = mount(SettingsPanel, {
      props: { open: true },
      global: { plugins: [pinia, createMinimalRouter()] },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(stub.calls('/healthz', 'GET')).toBe(1) // 挂载即拉（面板常驻挂载，数据随时新鲜）

    await vi.advanceTimersByTimeAsync(2000)
    expect(stub.calls('/healthz', 'GET')).toBe(2) // 2s 轮询
    await vi.advanceTimersByTimeAsync(2000)
    expect(stub.calls('/healthz', 'GET')).toBe(3)

    // /api/state 30s 周期刷新（T10 单审恢复：TopBar 退役时 subagent 一并移除了周期刷新，
    // 致 AlertBar 告警态新鲜度冻结在守卫首拉——D-032「运行中平台不可达→常驻告警」要求
    // 运行中可见，裁决在常驻挂载的面板组件恢复周期刷新，A-05 服务端心跳落地后对齐节奏）
    expect(stub.calls('/api/state', 'GET')).toBe(1) // 30s 未到不刷新
    await vi.advanceTimersByTimeAsync(30000)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // 30s 一拍
    await vi.advanceTimersByTimeAsync(30000)
    expect(stub.calls('/api/state', 'GET')).toBe(3)

    wrapper.unmount()
    const healthzAtUnmount = stub.calls('/healthz', 'GET')
    const stateAtUnmount = stub.calls('/api/state', 'GET')
    await vi.advanceTimersByTimeAsync(66000)
    expect(stub.calls('/healthz', 'GET')).toBe(healthzAtUnmount) // 卸载清理：两轮询均停
    expect(stub.calls('/api/state', 'GET')).toBe(stateAtUnmount)
  })
})

describe('Layout 组装（D-24/D-25：TopBar 退役 + AlertBar 常驻告警；D-26：AccessModal 接线）', () => {
  /**
   * Layout 挂载前经真 store.fetchState 预载（守卫首次导航语义），随后挂最小 memory router。
   * push 选项：从业务页起测（memory history 初始恒 '/'，「URL 不变」断言需先离港）。
   */
  async function mountLayout(
    handlers: Record<string, () => unknown>,
    options: { push?: string } = {},
  ): Promise<{ wrapper: VueWrapper; router: Router }> {
    stubFetch(handlers)
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    await store.fetchState()
    const router = createMinimalRouter()
    const wrapper = mount(Layout, { global: { plugins: [pinia, router] } })
    await flushPromises()
    if (options.push) {
      await router.push(options.push)
      await flushPromises()
    }
    active = wrapper
    return { wrapper, router }
  }

  it('正常态：顶部无 TopBar（.topbar 不在场）、无告警条；侧栏底齿轮点击 → 设置浮层三组在场；再点收起', async () => {
    const { wrapper } = await mountLayout({
      '/api/state': () => jsonResponse(activeFresh),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    // TopBar 退役：其全部内容随浮层关闭而不露（第一行内容收纳进左下角设置按钮）
    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.alert-bar').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('检查更新')
    expect(wrapper.text()).not.toContain('平台已连接')

    // D-23：侧栏底部齿轮（sidebar-foot），点击开设置浮层（开关状态归 Layout 本地 ref）
    const gear = wrapper.find('.sidebar-foot button[aria-label="设置"]')
    expect(gear.exists(), '侧栏底齿轮应存在（aria-label 设置）').toBe(true)
    expect(wrapper.find('.settings-panel').exists()).toBe(false) // 默认收起

    await gear.trigger('click')
    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('Test User') // ① 用户组
    expect(wrapper.text()).toContain('平台已连接') // ② 状态组
    expect(wrapper.text()).toContain('检查更新') // ③ 动作组
    expect(wrapper.text()).toContain('退出登录')

    await gear.trigger('click') // 齿轮再点收起（Layout 本地开关切换）
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
  })

  it('D-26 接入与平台设置弹窗接线：浮层第三项点击 → 浮层收起 + AccessModal 开（三件套在场，两浮层互斥）；Esc 关弹窗回业务页（URL 不变）', async () => {
    const { wrapper, router } = await mountLayout(
      {
        '/api/state': () => jsonResponse(activeFresh),
        '/healthz': () => jsonResponse(HEALTHY),
        '/api/config/platform': () => jsonResponse({ baseUrl: 'http://192.168.1.5:18000' }),
      },
      { push: '/employees' },
    )
    expect(router.currentRoute.value.path).toBe('/employees')
    // 开设置浮层（业务页 → 设置）
    await wrapper.find('.sidebar-foot button[aria-label="设置"]').trigger('click')
    expect(wrapper.find('.settings-panel').exists()).toBe(true)

    // 浮层第三项（D-26：button emit，无锚点）
    expect(wrapper.findAll('.settings-panel a').length).toBe(0)
    const accessItem = wrapper.findAll('.settings-panel button').find((item) => item.text() === '接入与平台设置')
    expect(accessItem, '动作组第三项应为 button').toBeTruthy()
    await accessItem!.trigger('click')
    await flushPromises()

    // 互斥：浮层收起 + 弹窗在场（三件套内容锚点）
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(wrapper.find('.access-modal-mask').exists()).toBe(true)
    expect(wrapper.find('.modal-title').text()).toBe('接入与平台设置')
    expect(wrapper.text()).toContain('已激活') // AccessStatusCard
    expect(wrapper.text()).toContain('平台连接') // PlatformConfigCard
    expect(wrapper.text()).toContain('发送终端心跳') // AccessActions
    // URL 不变（弹窗承载，不整页跳转——D-26 动线修复核心：业务页上下文不丢）
    expect(router.currentRoute.value.path).toBe('/employees')

    // Esc 关闭弹窗回业务页（浮层不复活，单向互斥）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.access-modal-mask').exists()).toBe(false)
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/employees')
  })

  it('告警态（REVOKED）→ AlertBar 在 main 顶部常驻（红条文案在场，不藏进浮层）', async () => {
    const { wrapper } = await mountLayout({
      '/api/state': () => jsonResponse(revokedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    // AlertBar 组件级行为由 alert-bar.test 覆盖；此处锚定 Layout 装配（main 顶部红条在场）
    const main = wrapper.find('main')
    expect(main.find('.alert-bar').exists()).toBe(true)
    expect(main.find('.alert-bar').text()).toContain('实例已被平台撤销')
    expect(main.find('.alert-bar').text()).toContain('请联系管理员')
  })
})
