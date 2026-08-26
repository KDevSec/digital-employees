// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PlatformConfigCard from '../src/components/access/PlatformConfigCard.vue'

/**
 * PlatformConfigCard（I0-5 T8，设计 D-16：接入页 hero 区「平台连接」配置卡）——
 * 挂载拉取 GET /api/config/platform 显示当前地址；行内编辑 + 保存成功反馈（tag-green 已保存）；
 * 非法输入（空/非 http(s) 开头）前端拦截不发 PUT；后端 400 错误消息透传展示（red-bg 提示条）。
 * 前端校验只拦 scheme（快速反馈）；完整 URL 合法性由服务端 zod 兜底（400 透传）——分工见组件头注释。
 * fetch 以 stubGlobal 顶替（沿 access-view.test.ts 手法，键含 method：GET/PUT 同路径并存）。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  }
}

const CURRENT = { baseUrl: 'http://192.168.1.5:18000' }

/** 按 METHOD+URL 分发的 fetch 桩（与 access-view.test.ts 同手法，键加 method——GET/PUT 同路径并存） */
function stubFetch(handlers: Record<string, () => unknown>): { calls: (url: string, method: string) => number } {
  const counter = new Map<string, number>()
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    counter.set(key, (counter.get(key) ?? 0) + 1)
    const handler = handlers[key]
    if (!handler) throw new Error(`unexpected fetch: ${key}`)
    const result = handler()
    if (result instanceof Error) throw result
    return result
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls: (url: string, method: string) => counter.get(`${method} ${url}`) ?? 0,
  }
}

async function mountCard(handlers: Record<string, () => unknown>) {
  const stub = stubFetch(handlers)
  const wrapper = mount(PlatformConfigCard)
  await flushPromises()
  return { stub, wrapper }
}

/** 点保存按钮（按钮文案可能处于 saving 态，按「保存」前缀匹配） */
async function clickSave(wrapper: ReturnType<typeof mount>): Promise<void> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().startsWith('保存'))
  expect(button, '保存按钮应存在').toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
}

describe('PlatformConfigCard 挂载与显示', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('挂载拉取 GET /api/config/platform：标题「平台连接」+ 说明文案 + 当前地址', async () => {
    const { stub, wrapper } = await mountCard({
      'GET /api/config/platform': () => jsonResponse(CURRENT),
    })
    expect(stub.calls('/api/config/platform', 'GET')).toBe(1)
    const text = wrapper.text()
    expect(text).toContain('平台连接')
    expect(text).toContain('管控平台地址，前期服务器切换时可在此修改')
    expect(text).toContain('http://192.168.1.5:18000')
    wrapper.unmount()
  })

  it('GET 失败（服务不可达）→ 不白屏：显示读取失败提示，输入仍可用可保存', async () => {
    const { stub, wrapper } = await mountCard({
      'GET /api/config/platform': () => new Error('network down'),
      'PUT /api/config/platform': () => jsonResponse({ baseUrl: 'http://10.0.0.8:18000' }),
    })
    expect(wrapper.text()).toContain('无法读取当前配置')
    await wrapper.find('input').setValue('http://10.0.0.8:18000')
    await clickSave(wrapper)
    expect(stub.calls('/api/config/platform', 'PUT')).toBe(1)
    wrapper.unmount()
  })
})

describe('PlatformConfigCard 编辑保存（成功反馈 tag-green）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('编辑 + 保存成功 → PUT 新值；当前地址更新为新值 + 「已保存」成功反馈', async () => {
    const { stub, wrapper } = await mountCard({
      'GET /api/config/platform': () => jsonResponse(CURRENT),
      'PUT /api/config/platform': () => jsonResponse({ baseUrl: 'http://10.0.0.8:18000' }),
    })
    await wrapper.find('input').setValue('http://10.0.0.8:18000')
    await clickSave(wrapper)
    expect(stub.calls('/api/config/platform', 'PUT')).toBe(1)
    const text = wrapper.text()
    expect(text).toContain('已保存')
    // 当前地址行已翻到新值
    expect(wrapper.find('.row strong').text()).toBe('http://10.0.0.8:18000')
    wrapper.unmount()
  })
})

describe('PlatformConfigCard 输入校验（前端拦截，不发请求）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['空串', ''],
    ['非 http(s) scheme（ftp）', 'ftp://files.example.com'],
    ['缺 scheme', '192.168.1.5:8080'],
  ])('非法输入（%s）→ 不发 PUT，显示校验提示', async (_label, value) => {
    const { stub, wrapper } = await mountCard({
      'GET /api/config/platform': () => jsonResponse(CURRENT),
      'PUT /api/config/platform': () => jsonResponse({ baseUrl: 'http://never-sent.example' }),
    })
    await wrapper.find('input').setValue(value)
    await clickSave(wrapper)
    expect(stub.calls('/api/config/platform', 'PUT')).toBe(0)
    expect(wrapper.text()).toContain('平台地址必须以 http:// 或 https:// 开头')
    wrapper.unmount()
  })
})

describe('PlatformConfigCard 服务端错误（400 透传展示）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('后端 400 → 错误消息透传展示（形状 {error:{code,message}} 沿 PlatformError），当前地址不翻新值', async () => {
    const { stub, wrapper } = await mountCard({
      'GET /api/config/platform': () => jsonResponse(CURRENT),
      'PUT /api/config/platform': () =>
        jsonResponse(
          { error: { code: 'INVALID_PLATFORM_URL', message: '平台地址必须是合法 URL' } },
          { ok: false, status: 400, statusText: 'Bad Request' },
        ),
    })
    await wrapper.find('input').setValue('http://a b.example') // 前端 scheme 拦截放行（http:// 开头），完整合法性交服务端
    await clickSave(wrapper)
    expect(stub.calls('/api/config/platform', 'PUT')).toBe(1)
    expect(wrapper.text()).toContain('平台地址必须是合法 URL')
    expect(wrapper.find('.row strong').text()).toBe('http://192.168.1.5:18000') // 保存失败，当前地址不变
    wrapper.unmount()
  })
})
