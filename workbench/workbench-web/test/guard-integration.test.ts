// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import type { Router } from 'vue-router'

/**
 * 路由守卫集成（I0-5 T3，设计 D-7）：真 router（src/router 全量装配：Layout 嵌套路由 + beforeEach 守卫）
 * + setActivePinia + stubGlobal fetch，走真实导航管线。
 *
 * 环境与隔离手法：
 * - createWebHistory 顶替为 createMemoryHistory（沿 test/router.test.ts 手法）：router 是模块级单例，
 *   每测试经 vi.resetModules + 动态 import 取全新实例，各自独立 history（jsdom 共享 window.history 会串态）；
 *   vi.mock 注册表不受 resetModules 影响，桩与部分 mock 持续生效。
 * - AccessView 桩化：其 onMounted 自拉 /api/state（T2 语义）会污染「守卫只拉一次」计数，
 *   接入页自身行为已由 access-view.test.ts 覆盖；桩渲染 access-stub 标记文本供落点断言。
 * - pinia 经动态 import 取与守卫同注册表副本的 createPinia/setActivePinia（守卫回调内 useSessionStore()
 *   读的是 active pinia——测试侧先装，等价 app.use(createPinia()) 的安装语义）。
 */

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: actual.createMemoryHistory }
})

vi.mock('../src/views/AccessView.vue', () => ({
  default: { name: 'AccessViewStub', render: () => h('div', 'access-stub') },
}))

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  }
}

const unauthenticatedState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

const authenticatedState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  authenticated: true,
  user: { name: '张三' },
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

let wrapper: VueWrapper | undefined

/** 全新 router + 全新 pinia 挂根壳 App（= main.ts 装配形态） */
async function mountApp(): Promise<{ router: Router; text: () => string }> {
  vi.resetModules()
  const routerModule = await import('../src/router')
  const piniaModule = await import('pinia')
  const pinia = piniaModule.createPinia()
  piniaModule.setActivePinia(pinia)
  const { default: App } = await import('../src/App.vue')
  const mounted = mount(App, { global: { plugins: [pinia, routerModule.router] } })
  wrapper = mounted
  await routerModule.router.isReady()
  await flushPromises()
  return { router: routerModule.router, text: () => mounted.text() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('守卫集成：未登录可达面收敛到接入页（D-7）', () => {
  it('未认证：三业务域路径全部重定向落 /，且页面不露侧栏导航（D-5 接入页全屏 / D-031 不给死入口）', async () => {
    stubFetch({ '/api/state': () => jsonResponse(unauthenticatedState) })
    const { router, text } = await mountApp()
    expect(router.currentRoute.value.path).toBe('/') // 初始导航（目标 /）放行
    for (const path of ['/employees', '/bases', '/kanban']) {
      await router.push(path)
      await flushPromises()
      expect(router.currentRoute.value.path, `未认证访问 ${path} 应重定向落 /`).toBe('/')
    }
    expect(text()).toContain('access-stub') // 落地接入页
    expect(text()).not.toContain('我的群组与对话') // 侧栏未挂（未登录不露导航）
  })

  it('fetch 失败（reject）→ 按未认证处理：/employees 重定向 /（fetchAccessState 归一 null → authenticated false）', async () => {
    stubFetch({ '/api/state': () => new Error('network down') })
    const { router, text } = await mountApp()
    await router.push('/employees')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(text()).toContain('access-stub')
  })
})

describe('守卫集成：登录态放行与 Layout 占位渲染', () => {
  it('认证后：三域逐页放行且渲染对应占位说明文案；侧栏在场；已登录访问 / 不跳转', async () => {
    stubFetch({ '/api/state': () => jsonResponse(authenticatedState) })
    const { router, text } = await mountApp()
    await router.push('/employees')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/employees')
    // 标题「我的员工」与侧栏项同名，占位说明文案才是 Placeholder 页面渲染的证据
    expect(text()).toContain('员工列表即将上线')
    expect(text()).toContain('我的群组与对话') // Layout 侧栏在场（含置灰项）

    await router.push('/bases')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/bases')
    expect(text()).toContain('底座探测与安装管理即将上线')

    await router.push('/kanban')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(text()).toContain('任务看板即将上线')

    // 已登录访问 / 不跳转（demo 语义，D-7 注）：接入页常驻可达（登录后即状态卡）
    await router.push('/')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(text()).toContain('access-stub')
  })
})

describe('守卫集成：/api/state 只拉一次（D-7 启动拉一次）', () => {
  it('首次导航拉取后，后续多次导航不再重复 fetch（session store loaded 门闩）', async () => {
    const stub = stubFetch({ '/api/state': () => jsonResponse(authenticatedState) })
    const { router } = await mountApp()
    expect(stub.calls('/api/state', 'GET')).toBe(1) // 初始导航已拉一次
    await router.push('/employees')
    await flushPromises()
    await router.push('/bases')
    await flushPromises()
    await router.push('/kanban')
    await flushPromises()
    await router.push('/')
    await flushPromises()
    expect(stub.calls('/api/state', 'GET')).toBe(1) // 四次后续导航后仍是 1
  })
})
