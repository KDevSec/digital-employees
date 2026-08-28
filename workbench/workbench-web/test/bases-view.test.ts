// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, afterEach, vi } from 'vitest'

import BasesView from '../src/views/BasesView.vue'

/**
 * 底座与环境页（L2 安装线填充 I0-5 预留版面；D-062 档位配置化）：
 *
 * 契约（service 真码为准）：
 * - GET /api/bases → BaseCard[]（present/version/supported/employees_count/last_install_at）
 * - POST /api/bases/probe → 探测刷新（旁路缓存）
 * - GET /api/bases/:id/tier-config → { tiers: {五档->model_id}, customized: string[] }
 * - PUT /api/bases/:id/tier-config body { tiers: {...} } → 同 GET 响应
 * - GET /api/bases/:id/models → ModelInfo[]（合并配置后展平——候选下拉数据源）
 *
 * 覆盖（TDD 红→绿）：
 * - 三底座卡片：在场显示版本+supported，不在场显示「未检测到」
 * - 「重新探测」触发 probe + 列表刷新
 * - 档位配置面板：选底座→GET tier-config+models→五档下拉分配模型
 * - 保存 → PUT 载荷五档齐全；customized 档位显示徽标
 * - PUT 400 → 常驻错误文案（非 toast，纪律⑥）
 * - 零假数据：bases 空数组 → 不渲染卡片与配置面板
 * - 禁词红线：不含「AgentHub」「digital-staff」
 */

interface BaseCard {
  id: string
  label: string
  present: boolean
  version: string | null
  version_tested: string
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

const BASES: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: true, version: '2.1.226', version_tested: '2.1.226', supported: true, employees_count: 1, last_install_at: '2026-08-27T00:00:00Z' },
  { id: 'codebuddy', label: 'CodeBuddy', present: true, version: '2.139.0', version_tested: '2.137.1', supported: true, employees_count: 0, last_install_at: null },
  { id: 'qoder', label: 'Qoder', present: false, version: null, version_tested: '1.1.32', supported: null, employees_count: 0, last_install_at: null },
]

const TIER_CONFIG = {
  tiers: { 评审安全档: 'Qwen3.8-Max', 设计档: 'Qwen3.7-Max', 探索档: 'Qwen3.8-Max', 编码档: 'Qwen3.7-Plus', 执行档: 'Lite' },
  customized: [] as string[],
}

const MODELS = [
  { id: 'Qwen3.8-Max', label: 'Qwen3.8-Max（评审安全档）', tier: '评审安全档' },
  { id: 'Qwen3.7-Max', label: 'Qwen3.7-Max（设计档）', tier: '设计档' },
  { id: 'Qwen3.7-Plus', label: 'Qwen3.7-Plus（编码档）', tier: '编码档' },
  { id: 'Qwen3.8-Flash', label: 'Qwen3.8-Flash', tier: undefined },
  { id: 'Lite', label: 'Lite（执行档）', tier: '执行档' },
]

interface FetchRoutes {
  bases?: BaseCard[]
  tierConfig?: { ok: boolean; status: number; body: unknown }
  models?: unknown[]
  /** PUT 响应（按 body 断言回传） */
  putResponse?: { ok: boolean; status: number; body: unknown }
}

function makeFetchMock(routes: FetchRoutes, spies?: { putBodies?: unknown[]; probeCalls?: number[] }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/bases' && method === 'GET') {
      return { ok: true, status: 200, json: async () => routes.bases ?? [] } as unknown as Response
    }
    if (url === '/api/bases/probe' && method === 'POST') {
      spies?.probeCalls?.push(1)
      return { ok: true, status: 200, json: async () => [] } as unknown as Response
    }
    if (url === '/api/bases/qoder/tier-config' && method === 'GET') {
      const r = routes.tierConfig ?? { ok: true, status: 200, body: TIER_CONFIG }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    if (url === '/api/bases/qoder/tier-config' && method === 'PUT') {
      spies?.putBodies?.push(JSON.parse(String(init?.body ?? '{}')))
      const r = routes.putResponse ?? { ok: true, status: 200, body: { ...TIER_CONFIG, customized: ['执行档'] } }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    if (url === '/api/bases/qoder/models' && method === 'GET') {
      return { ok: true, status: 200, json: async () => routes.models ?? MODELS } as unknown as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
  })
}

async function mountView(routes: FetchRoutes, spies?: { putBodies?: unknown[]; probeCalls?: number[] }) {
  vi.stubGlobal('fetch', makeFetchMock(routes, spies))
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(BasesView, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

describe('BasesView —— 底座与环境页（L2 填充；D-062 档位配置面）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('三底座卡片：在场显示版本/supported/已装员工数；不在场显示「未检测到」', async () => {
    const wrapper = await mountView({ bases: BASES })
    const cards = wrapper.findAll('[data-role="base-card"]')
    expect(cards.length).toBe(3)

    const cc = cards.find((c) => c.attributes('data-base') === 'claude-code')!
    expect(cc.text()).toContain('2.1.226')
    expect(cc.text()).toContain('已支持')
    expect(cc.text()).toContain('1 名员工')

    const q = cards.find((c) => c.attributes('data-base') === 'qoder')!
    expect(q.text()).toContain('未检测到')
    expect(q.attributes('data-present')).toBe('false')
  })

  it('「重新探测」触发 POST /api/bases/probe + 列表刷新', async () => {
    const probeCalls: number[] = []
    const wrapper = await mountView({ bases: BASES }, { probeCalls })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('重新探测'))!
    await btn.trigger('click')
    await flushPromises()
    expect(probeCalls.length).toBe(1)
  })

  it('档位配置面板：选中底座后展示五档下拉（候选=合并后 models 数据源）；初值 = tier-config 合并映射', async () => {
    const wrapper = await mountView({ bases: BASES })
    const q = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-base') === 'qoder')!
    await q.trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('[data-role="tier-row"]')
    expect(rows.length).toBe(5)
    // 执行档初值 = Lite（tier-config tiers）
    const execRow = rows.find((r) => (r.find('[data-role="tier-name"]').text() as string).includes('执行档'))!
    const execSelect = execRow.find('select')
    expect(execSelect.exists()).toBe(true)
    expect((execSelect.element as HTMLSelectElement).value).toBe('Lite')
    // 候选来自 models 端点（含 Qwen3.8-Flash 非档位映射项）
    const optionValues = execSelect.findAll('option').map((o) => o.attributes('value'))
    expect(optionValues).toContain('Qwen3.8-Max')
    expect(optionValues).toContain('Qwen3.8-Flash')
    expect(optionValues).toContain('Lite')
  })

  it('保存档位映射 -> PUT 五档齐全载荷；customized 档位显示「自定义」徽标', async () => {
    const putBodies: { tiers?: Record<string, string> }[] = []
    const wrapper = await mountView({ bases: BASES }, { putBodies: putBodies as unknown[] })
    const q = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-base') === 'qoder')!
    await q.trigger('click')
    await flushPromises()

    const saveBtn = wrapper.find('[data-role="save-tier-config"]')
    await saveBtn.trigger('click')
    await flushPromises()

    expect(putBodies.length).toBe(1)
    const tiers = putBodies[0].tiers ?? {}
    expect(Object.keys(tiers).sort()).toEqual(['执行档', '探索档', '编码档', '设计档', '评审安全档'])
    expect(tiers['执行档']).toBe('Lite')

    // PUT 响应 customized=['执行档'] 后，该档位行出「自定义」徽标
    const rows = wrapper.findAll('[data-role="tier-row"]')
    const execRow = rows.find((r) => (r.find('[data-role="tier-name"]').text() as string).includes('执行档'))!
    expect(execRow.find('[data-role="customized-badge"]').exists()).toBe(true)
  })

  it('PUT 400 -> 常驻错误文案（非 toast）', async () => {
    const wrapper = await mountView({
      bases: BASES,
      putResponse: { ok: false, status: 400, body: { error: { code: 'INVALID_REQUEST', message: '五档映射必须齐全且值非空' } } },
    })
    const q = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-base') === 'qoder')!
    await q.trigger('click')
    await flushPromises()
    await wrapper.find('[data-role="save-tier-config"]').trigger('click')
    await flushPromises()
    const err = wrapper.find('[data-role="save-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('五档映射必须齐全且值非空')
  })

  it('零假数据：bases 空数组 -> 不渲染任何底座卡，档位配置面板空态', async () => {
    const wrapper = await mountView({ bases: [] })
    expect(wrapper.findAll('[data-role="base-card"]').length).toBe(0)
    expect(wrapper.find('[data-role="tier-config-panel"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('未检测到任何底座')
  })

  it('禁词红线：页面源码不含 AgentHub / digital-staff', async () => {
    const fs = await import('node:fs')
    const { resolve } = await import('node:path')
    const vueSrc = fs.readFileSync(resolve(__dirname, '../src/views/BasesView.vue'), 'utf8')
    expect(vueSrc).not.toContain('AgentHub')
    expect(vueSrc).not.toContain('digital-staff')
  })
})
