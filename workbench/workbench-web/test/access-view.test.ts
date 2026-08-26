// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccessView from '../src/views/AccessView.vue'

/**
 * AccessView（I0-5 T2 立项：demo ui.ts 页面骨架的 Vue 化组装；T9 增 D-19/D-20 双形态）：
 * - 未登录 = 居中单卡登录页（D-19）：logo/品牌/引导语/整宽「企业账号登录」主按钮 +
 *   卡底一行（「平台设置 ▾」展开 T8 配置卡 + 服务状态·版本小字）；头部条在该形态下移除；
 * - 已登录 = 简化状态页（D-20）：头部条保留（品牌+健康徽章）+ 一行 hero，删安全边界卡，
 *   状态卡主位 + 平台配置卡次位；
 * - 挂载拉取 /api/state、5s 审批轮询（demo L31）、2s 服务健康轮询（Home 退役承接）、
 *   动作文案（demo messageNode）、fetch 失败不可达态。
 * fetch 以 stubGlobal 顶替；假定时下用 advanceTimersByTimeAsync 刷微任务（flushPromises 依赖 setTimeout 会被假定时冻结）。
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

const unauthenticatedState = {
  installationId: 'inst-001',
  status: 'NEW',
  authenticated: false,
}

const pendingReviewState = {
  installationId: 'inst-001',
  enrollmentId: 'enr-9',
  status: 'PENDING_REVIEW',
  authenticated: true,
  user: { name: '张三' },
}

const activeState = {
  installationId: 'inst-001',
  workbenchId: 'wb-7',
  status: 'ACTIVE',
  lastHeartbeatAt: '2026-08-25T10:00:00Z',
  authenticated: true,
  user: { name: '张三' },
}

/** 按路径分发的 fetch 桩：state 序列可变（轮询退出场景需要状态翻转） */
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

describe('AccessView 挂载与渲染', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('未登录 → 居中登录卡（D-19）：品牌三行 + 引导语 + 整宽「企业账号登录」主按钮 + 卡底服务状态行', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    const text = wrapper.text()
    expect(stub.calls('/api/state', 'GET')).toBe(1)
    // 登录卡品牌区（D-19：登录卡自带品牌——头部条在该形态下移除，页面更纯粹）
    expect(text).toContain('DevZero')
    expect(text).toContain('数字员工工作台')
    expect(text).toContain('使用企业账号登录以继续')
    expect(text).toContain('企业账号登录')
    // 卡底服务状态行：健康轮询数据（badge 摘要 + 版本行）进卡底小字
    expect(text).toContain('运行中')
    expect(text).toContain('v0.1.0')
    // 登录卡形态不渲染头部条/状态卡（未登录不露接入状态明细）
    expect(wrapper.find('.head').exists()).toBe(false)
    expect(text).not.toContain('工作台接入状态')
    expect(text).not.toContain('inst-001')
    expect(text).not.toContain('请先登录')
    // 「返回管理平台」链接不渲染（设计 G-5：Vue 侧无 platformPublicUrl 来源）
    expect(text).not.toContain('返回管理平台')
    wrapper.unmount()
  })

  it('fetch 失败（/api/state 不可达）→ 登录卡仍渲染 + 不可达文案，而非白屏', async () => {
    stubFetch({
      '/api/state': () => new Error('network down'),
      '/healthz': () => new Error('network down'),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('服务不可达')
    expect(text).toContain('无法获取接入状态')
    // state null 归未登录形态：登录卡骨架仍在
    expect(text).toContain('DevZero')
    expect(text).toContain('企业账号登录')
    expect(text).not.toContain('inst-001')
    // 卡底服务状态行同步显示服务不可用（红点态）
    expect(text).toContain('服务不可用')
    wrapper.unmount()
  })

  it('已登录 → 简化状态页（D-20）：头部条保留 + 一行 hero；状态卡主位 + 配置卡次位；安全边界卡已删', async () => {
    stubFetch({
      '/api/state': () => jsonResponse(activeState),
      '/healthz': () => jsonResponse(HEALTHY),
      '/api/config/platform': () => jsonResponse({ baseUrl: 'http://192.168.1.5:18000' }),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    const text = wrapper.text()
    // 头部条（品牌 + 健康徽章）保留（D-20：布局骨架沿用）
    expect(wrapper.find('.head').exists()).toBe(true)
    expect(text).toContain('运行中')
    expect(text).toContain('v0.1.0')
    // hero 一行：h1 + sub 一句（eyebrow 已删）
    expect(text).toContain('工作台接入状态')
    expect(text).not.toContain('Local execution plane')
    // 状态卡主位（AccessStatusCard 状态行 + AccessActions 按钮）
    expect(text).toContain('inst-001')
    expect(text).toContain('wb-7')
    expect(text).toContain('已激活')
    expect(text).toContain('发送工作台心跳')
    expect(text).toContain('退出登录')
    // 平台配置卡次位（T8 卡从 hero 侧挂迁入 grid 次位）
    expect(text).toContain('平台连接')
    expect(text).toContain('http://192.168.1.5:18000')
    // 安全边界卡已删（D-20：demo 时代开发者展示物，用户裁决不需要）
    expect(text).not.toContain('安全边界')
    expect(text).not.toContain('Keycloak OIDC + PKCE')
    wrapper.unmount()
  })
})

describe('AccessView 登录卡（D-19）：平台设置折叠区与整页登录跳转', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('「平台设置 ▾」：点击展开 T8 配置卡（挂载拉 GET /api/config/platform），再点收起', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/healthz': () => jsonResponse(HEALTHY),
      '/api/config/platform': () => jsonResponse({ baseUrl: 'http://192.168.1.5:18000' }),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    expect(wrapper.text()).not.toContain('平台连接') // 默认收起

    const toggle = wrapper.findAll('button').find((candidate) => candidate.text().startsWith('平台设置'))
    expect(toggle, '「平台设置 ▾」入口应存在').toBeTruthy()
    await toggle!.trigger('click')
    await flushPromises()
    expect(stub.calls('/api/config/platform', 'GET')).toBe(1) // 展开才挂载配置卡并拉取
    expect(wrapper.text()).toContain('平台连接')
    expect(wrapper.text()).toContain('http://192.168.1.5:18000')

    await toggle!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('平台连接') // 收起卸载
    wrapper.unmount()
  })

  it('登录卡「企业账号登录」点击 → window.location.href = /auth/login（OIDC 出站 302 整页跳转）', async () => {
    // 桩化 location（沿 access-actions.test.ts 手法：jsdom 不真导航，以可写 location 桩断言赋值）；
    // 测毕还原 descriptor，避免污染后续用例（useHealthPolling 读 window.location.port）
    const original = Object.getOwnPropertyDescriptor(window, 'location')
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: 'http://localhost:3000/', port: '3000' } })
    try {
      stubFetch({
        '/api/state': () => jsonResponse(unauthenticatedState),
        '/healthz': () => jsonResponse(HEALTHY),
      })
      const wrapper = mount(AccessView)
      await flushPromises()
      const button = wrapper.findAll('button').find((candidate) => candidate.text() === '企业账号登录')
      expect(button, '登录卡主按钮应存在').toBeTruthy()
      await button!.trigger('click')
      expect(window.location.href).toBe('/auth/login')
      wrapper.unmount()
    } finally {
      if (original) Object.defineProperty(window, 'location', original)
    }
  })
})

describe('AccessView 审批进度轮询（demo L31：authenticated 且 PENDING_REVIEW/APPROVED → 5s POST /api/progress + 刷新）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('PENDING_REVIEW 登录态：每 5s 触发一次 POST /api/progress 并刷新状态', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(pendingReviewState),
      '/api/progress': () => jsonResponse({ status: 'PENDING_REVIEW' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const wrapper = mount(AccessView)
    await vi.advanceTimersByTimeAsync(0)
    expect(stub.calls('/api/state', 'GET')).toBe(1)
    expect(stub.calls('/api/progress', 'POST')).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)
    expect(stub.calls('/api/progress', 'POST')).toBe(1)
    expect(stub.calls('/api/state', 'GET')).toBe(2) // tick 内 progress 成功后刷新

    await vi.advanceTimersByTimeAsync(5000)
    expect(stub.calls('/api/progress', 'POST')).toBe(2)
    wrapper.unmount()
  })

  it('条件退出：轮询刷新拉到 ACTIVE 后停止（不再调 /api/progress）', async () => {
    let stateCalls = 0
    const stub = stubFetch({
      '/api/state': () => {
        stateCalls += 1
        return jsonResponse(stateCalls === 1 ? pendingReviewState : activeState)
      },
      '/api/progress': () => jsonResponse({ status: 'ACTIVE' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const wrapper = mount(AccessView)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(stub.calls('/api/progress', 'POST')).toBe(1)
    expect(wrapper.text()).toContain('已激活') // 状态卡已翻到 ACTIVE

    await vi.advanceTimersByTimeAsync(15000)
    expect(stub.calls('/api/progress', 'POST')).toBe(1) // 轮询已停
    wrapper.unmount()
  })

  it('unmount 停止轮询（demo 无此生命周期，Vue 化补齐）', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(pendingReviewState),
      '/api/progress': () => jsonResponse({ status: 'PENDING_REVIEW' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const wrapper = mount(AccessView)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(stub.calls('/api/progress', 'POST')).toBe(1)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(15000)
    expect(stub.calls('/api/progress', 'POST')).toBe(1)
  })

  it('未登录态：不轮询 /api/progress', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/api/progress': () => jsonResponse({ status: 'PENDING_REVIEW' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const wrapper = mount(AccessView)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10000)
    expect(stub.calls('/api/progress', 'POST')).toBe(0)
    wrapper.unmount()
  })
})

describe('AccessView 服务健康徽章轮询（Home.vue 退役，2s 轮询 + onUnmounted 清理）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('每 2s 刷新 healthz；unmount 后停止', async () => {
    const stub = stubFetch({
      '/api/state': () => jsonResponse(unauthenticatedState),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    vi.useFakeTimers()
    const wrapper = mount(AccessView)
    await vi.advanceTimersByTimeAsync(0)
    expect(stub.calls('/healthz', 'GET')).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(stub.calls('/healthz', 'GET')).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(stub.calls('/healthz', 'GET')).toBe(3)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(6000)
    expect(stub.calls('/healthz', 'GET')).toBe(3)
  })
})

describe('AccessView 动作处理（AccessActions emit → api 动作 → messageNode 语义文案）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function clickButton(wrapper: ReturnType<typeof mount>, label: string): Promise<void> {
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)
    expect(button, `按钮应存在：${label}`).toBeTruthy()
    await button!.trigger('click')
  }

  it('动作失败 → 显示服务端错误文案（demo call() throw 语义），且不刷新成功态', async () => {
    stubFetch({
      '/api/state': () => jsonResponse({ ...unauthenticatedState, authenticated: true, status: 'NEW' }),
      '/api/enroll': () => jsonResponse({ error: { code: 'PLATFORM_DOWN', message: '平台连接失败' } }, { ok: false, status: 502, statusText: 'Bad Gateway' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    await clickButton(wrapper, '重新提交接入申请')
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('平台连接失败')
    expect(text).not.toContain('处理中…')
    wrapper.unmount()
  })

  it('动作成功 → 「操作成功」文案 + 重拉 /api/state 刷新状态卡', async () => {
    let stateCalls = 0
    stubFetch({
      '/api/state': () => {
        stateCalls += 1
        return jsonResponse(stateCalls === 1 ? { ...unauthenticatedState, authenticated: true, status: 'NEW' } : pendingReviewState)
      },
      '/api/enroll': () => jsonResponse({ status: 'PENDING_REVIEW' }),
      '/healthz': () => jsonResponse(HEALTHY),
    })
    const wrapper = mount(AccessView)
    await flushPromises()
    expect(wrapper.text()).not.toContain('待审批')
    await clickButton(wrapper, '重新提交接入申请')
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('操作成功')
    expect(text).toContain('待审批')
    wrapper.unmount()
  })
})
