// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InstallModal from '../src/components/wizard/InstallModal.vue'

/**
 * Task 23（D7 W6 追加）：InstallModal 接真实底座域测试。
 *
 * 契约（service 真码为准）：
 * - GET /api/bases → BaseCard[] {id,label,present,version,version_tested,supported,employees_count,last_install_at}
 * - POST /api/bases/probe body {base?} → 单底座 ProbeCard / 缺省 ProbeCard[]（仅作触发；
 *   探测后组件再 GET /api/bases 刷新缓存列表）
 * - POST /api/deployments/plan body {employee_id, base} → {negotiation, placements}
 * - POST /api/deployments/execute body {employee_id, base} → InstallReport（含 result/error）
 * - POST /api/deployments/verify body {employee_id, base} → {drift: DriftItem[]}
 *
 * 错误形状统一：{ error: { code, message } }
 *
 * 测试覆盖（TDD 红→绿）：
 * - bases 数据渲染（在场可选 / 不在场灰置+「未检测到」）
 * - 不在场卡不可勾选
 * - 重新探测触发 probeBases + 列表刷新
 * - 三步链状态机：plan → execute → verify 顺序调用 + body 断言（employee_id/base 正确）
 * - plan 落位清单渲染
 * - execute 500 + error.message → 真实错误文案 + 重试按钮再次调 execute
 * - 全链完成显示报告摘要
 * - 禁词红线：不含「AgentHub」「digital-staff」
 * - 零假数据：fetchBases 返回空数组 → 不渲染任何底座卡（无静态底座残留）
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

const BASES_TWO_PRESENT: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: true, version: '1.0.0', version_tested: '1.0.0', supported: true, employees_count: 0, last_install_at: null },
  { id: 'codebuddy', label: 'CodeBuddy', present: true, version: '2.0.0', version_tested: '2.0.0', supported: true, employees_count: 1, last_install_at: '2026-08-20T00:00:00Z' },
  { id: 'qoder', label: 'Qoder', present: false, version: null, version_tested: '0.9.0', supported: null, employees_count: 0, last_install_at: null },
]

const BASES_ONE_PRESENT: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: true, version: '1.0.0', version_tested: '1.0.0', supported: true, employees_count: 0, last_install_at: null },
  { id: 'codebuddy', label: 'CodeBuddy', present: false, version: null, version_tested: '2.0.0', supported: null, employees_count: 0, last_install_at: null },
  { id: 'qoder', label: 'Qoder', present: false, version: null, version_tested: '0.9.0', supported: null, employees_count: 0, last_install_at: null },
]

/** reprobe 后 claude-code 也变 absent（防滞留测试用——选中态不应滞留） */
const BASES_NONE_PRESENT: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: false, version: null, version_tested: '1.0.0', supported: null, employees_count: 0, last_install_at: null },
  { id: 'codebuddy', label: 'CodeBuddy', present: false, version: null, version_tested: '2.0.0', supported: null, employees_count: 0, last_install_at: null },
  { id: 'qoder', label: 'Qoder', present: false, version: null, version_tested: '0.9.0', supported: null, employees_count: 0, last_install_at: null },
]

const BASES_ALL_PRESENT: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: true, version: '1.0.0', version_tested: '1.0.0', supported: true, employees_count: 0, last_install_at: null },
  { id: 'codebuddy', label: 'CodeBuddy', present: true, version: '2.0.0', version_tested: '2.0.0', supported: true, employees_count: 0, last_install_at: null },
  { id: 'qoder', label: 'Qoder', present: true, version: '0.9.0', version_tested: '0.9.0', supported: true, employees_count: 0, last_install_at: null },
]

const PROBE_ALL = BASES_ALL_PRESENT.map((b) => ({ base: b.id, present: b.present, version: b.version, probed_at: '2026-08-27T10:00:00Z', supported: b.supported ?? false }))

const PLAN_OK = {
  negotiation: {
    design_level: 'L1',
    reachable_level: 'L1',
    missing_required: [],
    degraded: [],
    warnings: [],
    blocked: null,
  },
  placements: [
    { source: 'AGENTS.md', target: 'config/CLAUDE.md', action: 'convert', conflict: null },
    { source: 'skills/tdd', target: 'config/skills/tdd', action: 'copy', conflict: null },
  ],
}

const EXECUTE_OK = {
  report_version: 1,
  employee_id: 'frontend-dev',
  package_version: '0.1.0',
  base: 'claude-code',
  base_version: '1.0.0',
  base_version_tested: '1.0.0',
  scope: { type: 'deployment', home: '/path/to/staff/claude-code/frontend-dev' },
  negotiation: { design_level: 'L1', reachable_level: 'L1', missing_required: [], degraded: [], warnings: [], blocked: null },
  placements: [
    { source: 'AGENTS.md', target: 'config/CLAUDE.md', action: 'convert', conflict: null },
    { source: 'skills/tdd', target: 'config/skills/tdd', action: 'copy', conflict: null },
  ],
  result: 'success',
  started_at: '2026-08-27T10:00:00Z',
  finished_at: '2026-08-27T10:00:05Z',
}

const VERIFY_OK = { drift: [] }

interface FetchRoutes {
  bases?: BaseCard[]
  basesAfterProbe?: BaseCard[]
  probe?: unknown
  plan?: { ok: boolean; status: number; body: unknown }
  execute?: { ok: boolean; status: number; body: unknown }
  verify?: { ok: boolean; status: number; body: unknown }
}

function makeFetchMock(routes: FetchRoutes) {
  let basesCallCount = 0
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/bases' && method === 'GET') {
      const data = basesCallCount === 0
        ? (routes.bases ?? [])
        : (routes.basesAfterProbe ?? routes.bases ?? [])
      basesCallCount++
      return { ok: true, status: 200, json: async () => data } as unknown as Response
    }
    if (url === '/api/bases/probe' && method === 'POST') {
      return { ok: true, status: 200, json: async () => routes.probe ?? PROBE_ALL } as unknown as Response
    }
    if (url === '/api/deployments/plan' && method === 'POST') {
      const r = routes.plan ?? { ok: true, status: 200, body: PLAN_OK }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    if (url === '/api/deployments/execute' && method === 'POST') {
      const r = routes.execute ?? { ok: true, status: 200, body: EXECUTE_OK }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    if (url === '/api/deployments/verify' && method === 'POST') {
      const r = routes.verify ?? { ok: true, status: 200, body: VERIFY_OK }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
  })
}

async function mountModal() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(InstallModal, {
    global: { plugins: [pinia] },
    props: { employeeId: 'frontend-dev' },
  })
  await flushPromises()
  return { wrapper }
}

/** 选第一个在场底座 → 下一步 → 开始安装（共用三步链前置流程） */
async function proceedToInstall(wrapper: VueWrapper) {
  const presentCard = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-present') === 'true')!
  await presentCard.trigger('click')
  await flushPromises()
  const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))!
  await nextBtn.trigger('click')
  await flushPromises()
  const startBtn = wrapper.findAll('button').find((b) => b.text().includes('开始安装'))!
  await startBtn.trigger('click')
  await flushPromises()
}

function callIndices(
  fetchMock: ReturnType<typeof vi.fn>,
  predicate: (url: string, init?: RequestInit) => boolean,
): number[] {
  const out: number[] = []
  fetchMock.mock.calls.forEach((call, idx) => {
    const [u, i] = call as [string, RequestInit?]
    if (predicate(u, i)) out.push(idx)
  })
  return out
}

describe('InstallModal —— bases 检测消费', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bases 数据渲染：在场卡可选 / 不在场灰置 + 「未检测到」标注', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_TWO_PRESENT }))
    const { wrapper } = await mountModal()
    const cards = wrapper.findAll('[data-role="base-card"]')
    expect(cards.length).toBe(3)
    const presentCards = cards.filter((c) => c.attributes('data-present') === 'true')
    expect(presentCards.length).toBe(2)
    for (const c of presentCards) {
      expect(c.classes()).not.toContain('disabled')
    }
    const absentCards = cards.filter((c) => c.attributes('data-present') === 'false')
    expect(absentCards.length).toBe(1)
    expect(absentCards[0].classes()).toContain('disabled')
    expect(absentCards[0].text()).toContain('未检测到')
  })

  it('不在场卡不可勾选（点击不进 selectedIds，下一步按钮仍 disabled）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_TWO_PRESENT }))
    const { wrapper } = await mountModal()
    const absentCard = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-present') === 'false')!
    await absentCard.trigger('click')
    await flushPromises()
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    expect(nextBtn?.attributes('disabled')).toBeDefined()
  })

  it('「重新探测」触发 POST /api/bases/probe + 列表刷新', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_TWO_PRESENT, basesAfterProbe: BASES_ALL_PRESENT, probe: PROBE_ALL }))
    const { wrapper } = await mountModal()
    expect(wrapper.findAll('[data-role="base-card"]').filter((c) => c.attributes('data-present') === 'true').length).toBe(2)
    const probeBtn = wrapper.findAll('button').find((b) => b.text().includes('重新探测'))
    expect(probeBtn).toBeTruthy()
    await probeBtn!.trigger('click')
    await flushPromises()
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const probeCalls = callIndices(fetchMock, (u, i) => u === '/api/bases/probe' && (i?.method ?? 'GET') === 'POST')
    expect(probeCalls.length).toBe(1)
    expect(wrapper.findAll('[data-role="base-card"]').filter((c) => c.attributes('data-present') === 'true').length).toBe(3)
  })

  it('防滞留：选中底座在 reprobe 后变 absent → 自动从 selectedBaseIds 清除（卡片不再 on / 下一步 disabled）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_ONE_PRESENT, basesAfterProbe: BASES_NONE_PRESENT, probe: PROBE_ALL }))
    const { wrapper } = await mountModal()
    // 初始：claude-code 在场，选中它
    const presentCard = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-present') === 'true')!
    await presentCard.trigger('click')
    await flushPromises()
    expect(presentCard.classes()).toContain('on')
    // 重新探测 → claude-code 也变 absent
    const probeBtn = wrapper.findAll('button').find((b) => b.text().includes('重新探测'))!
    await probeBtn.trigger('click')
    await flushPromises()
    // claude-code 卡现在 disabled（absent）且不再 on（selectedBaseIds 已被过滤清除）
    const cards = wrapper.findAll('[data-role="base-card"]')
    const claudeCard = cards.find((c) => c.text().includes('Claude Code'))!
    expect(claudeCard.attributes('data-present')).toBe('false')
    expect(claudeCard.classes()).toContain('disabled')
    expect(claudeCard.classes()).not.toContain('on')
    // 「下一步」按钮 disabled（无选中）
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    expect(nextBtn?.attributes('disabled')).toBeDefined()
  })

  it('toggleBase 允许反选「已选-but-now-absent」的底座（防御：reprobe 漏过滤时手动反选仍生效）', async () => {
    // 构造场景：初始选中 claude-code（present）→ reprobe 后变 absent，但若 reprobe 漏过滤，
    // 用户点 absent 卡应能反选（不会卡死 disabled+on 不可点击）
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_ONE_PRESENT, basesAfterProbe: BASES_NONE_PRESENT, probe: PROBE_ALL }))
    const { wrapper } = await mountModal()
    // 选中 claude-code（present）
    const presentCard = wrapper.findAll('[data-role="base-card"]').find((c) => c.attributes('data-present') === 'true')!
    await presentCard.trigger('click')
    await flushPromises()
    expect(presentCard.classes()).toContain('on')
    // reprobe → claude-code 变 absent；即便 reprobe 已自动过滤，再点 absent 卡也不应 stuck
    const probeBtn = wrapper.findAll('button').find((b) => b.text().includes('重新探测'))!
    await probeBtn.trigger('click')
    await flushPromises()
    const claudeCard = wrapper.findAll('[data-role="base-card"]').find((c) => c.text().includes('Claude Code'))!
    expect(claudeCard.attributes('data-present')).toBe('false')
    // 点击 absent 卡——不应增选（不在场不可新勾选）；也不报错
    await claudeCard.trigger('click')
    await flushPromises()
    expect(claudeCard.classes()).not.toContain('on')
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一步'))
    expect(nextBtn?.attributes('disabled')).toBeDefined()
  })

  it('零假数据：fetchBases 返回空数组 → 不渲染任何底座卡（无静态底座残留）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: [] }))
    const { wrapper } = await mountModal()
    expect(wrapper.findAll('[data-role="base-card"]').length).toBe(0)
    const text = wrapper.text()
    expect(text).not.toContain('Claude Code')
    expect(text).not.toContain('CodeBuddy')
    expect(text).not.toContain('Qoder')
  })

  it('禁词红线：UI 文案不含「AgentHub」「digital-staff」', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ bases: BASES_TWO_PRESENT }))
    const { wrapper } = await mountModal()
    const text = wrapper.text()
    expect(text).not.toContain('AgentHub')
    expect(text).not.toContain('digital-staff')
  })
})

describe('InstallModal —— deployments 三步链', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('三步链：plan → execute → verify 依次调用（body: {employee_id, base}）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      bases: BASES_ONE_PRESENT,
      plan: { ok: true, status: 200, body: PLAN_OK },
      execute: { ok: true, status: 200, body: EXECUTE_OK },
      verify: { ok: true, status: 200, body: VERIFY_OK },
    }))
    const { wrapper } = await mountModal()
    await proceedToInstall(wrapper)

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const planIdxs = callIndices(fetchMock, (u, i) => u === '/api/deployments/plan' && (i?.method ?? 'GET') === 'POST')
    const execIdxs = callIndices(fetchMock, (u, i) => u === '/api/deployments/execute' && (i?.method ?? 'GET') === 'POST')
    const verifyIdxs = callIndices(fetchMock, (u, i) => u === '/api/deployments/verify' && (i?.method ?? 'GET') === 'POST')
    expect(planIdxs.length).toBe(1)
    expect(execIdxs.length).toBe(1)
    expect(verifyIdxs.length).toBe(1)
    expect(planIdxs[0]).toBeLessThan(execIdxs[0])
    expect(execIdxs[0]).toBeLessThan(verifyIdxs[0])

    const planCall = fetchMock.mock.calls[planIdxs[0]]
    const execCall = fetchMock.mock.calls[execIdxs[0]]
    const verifyCall = fetchMock.mock.calls[verifyIdxs[0]]
    const planBody = JSON.parse(planCall[1]!.body as string) as { employee_id: string; base: string }
    expect(planBody.employee_id).toBe('frontend-dev')
    expect(planBody.base).toBe('claude-code')
    const execBody = JSON.parse(execCall[1]!.body as string) as { employee_id: string; base: string }
    expect(execBody.employee_id).toBe('frontend-dev')
    expect(execBody.base).toBe('claude-code')
    const verifyBody = JSON.parse(verifyCall[1]!.body as string) as { employee_id: string; base: string }
    expect(verifyBody.employee_id).toBe('frontend-dev')
    expect(verifyBody.base).toBe('claude-code')
  })

  it('plan 响应落位清单渲染（展示 source → target 落位计划表）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      bases: BASES_ONE_PRESENT,
      plan: { ok: true, status: 200, body: PLAN_OK },
      execute: { ok: true, status: 200, body: EXECUTE_OK },
      verify: { ok: true, status: 200, body: VERIFY_OK },
    }))
    const { wrapper } = await mountModal()
    await proceedToInstall(wrapper)
    const text = wrapper.text()
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('config/CLAUDE.md')
  })

  it('execute 500 + error.message → 真实错误文案 + 重试按钮再次调 execute', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      bases: BASES_ONE_PRESENT,
      plan: { ok: true, status: 200, body: PLAN_OK },
      execute: { ok: false, status: 500, body: { error: { code: 'INSTALL_FAILED', message: '执行失败：写入 config/CLAUDE.md 时 IO 错误' } } },
      verify: { ok: true, status: 200, body: VERIFY_OK },
    }))
    const { wrapper } = await mountModal()
    await proceedToInstall(wrapper)
    const text = wrapper.text()
    expect(text).toContain('执行失败：写入 config/CLAUDE.md 时 IO 错误')
    const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('重试'))
    expect(retryBtn).toBeTruthy()
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const beforeExec = callIndices(fetchMock, (u, i) => u === '/api/deployments/execute' && (i?.method ?? 'GET') === 'POST').length
    expect(beforeExec).toBe(1)
    await retryBtn!.trigger('click')
    await flushPromises()
    const afterExec = callIndices(fetchMock, (u, i) => u === '/api/deployments/execute' && (i?.method ?? 'GET') === 'POST').length
    expect(afterExec).toBe(2)
  })

  it('全链完成 → 显示安装报告摘要（result=success + base 标识）', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      bases: BASES_ONE_PRESENT,
      plan: { ok: true, status: 200, body: PLAN_OK },
      execute: { ok: true, status: 200, body: EXECUTE_OK },
      verify: { ok: true, status: 200, body: VERIFY_OK },
    }))
    const { wrapper } = await mountModal()
    await proceedToInstall(wrapper)
    const text = wrapper.text()
    expect(text).toContain('success')
    expect(text).toContain('claude-code')
  })
})
