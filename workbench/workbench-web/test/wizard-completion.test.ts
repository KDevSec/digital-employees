// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../src/api/templates', () => ({
  fetchTemplates: vi.fn(),
  fetchSkills: vi.fn(),
}))

import { fetchSkills, fetchTemplates } from '../src/api/templates'
import {
  generateEmployee,
  saveAsTemplate,
  validateId,
} from '../src/api/employees'
import CompletionPanel from '../src/components/wizard/CompletionPanel.vue'
import CreateWizard from '../src/views/CreateWizard.vue'
import type { WizardDraft } from '../src/stores/wizard'
import { useWizardStore } from '../src/stores/wizard'
import { clearDraft, DRAFT_KEY } from '../src/composables/useWizardDraft'

/**
 * Task 16（C5）：生成动作 + 完成态三动作。
 * - api/employees.ts：generateEmployee / validateId / saveAsTemplate（fetch 包装）
 * - CreateWizard step7 「生成员工包」按钮 → generate 三态处理（200/422/409/SKILL_MISSING）
 * - CompletionPanel：包路径 + files 清单 + 三动作（安装到底座/保存为角色模板/完成离开）
 * - InstallModal：底座数据 + 三步链行为由 test/install-modal.test.ts 详测（Task 23 W6 升级——
 *   消费 bases 域检测 + deployments 三步链 plan/execute/verify）；本文件只测生成与完成态动作。
 * - 保存模板：POST /api/templates（service 端未实现，404 → toast「保存模板服务未就绪」）
 * - 完成离开：router.push('/employees') + clearDraft()
 *
 * 禁词红线：除完成态显式「安装到底座」动作外全程无「底座」「安装」「AgentHub」字样。
 */

function setupStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useWizardStore()
  return { store, pinia }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/employees', component: { template: '<div/>' } },
    ],
  })
}

/** schema 兼容的好 draft（与 wizard-preview.test.ts 同形） */
function goodDraft(): WizardDraft {
  return {
    display: '前端开发',
    id: 'frontend-dev',
    idTouched: true,
    avatar: '🧑‍💻',
    org: 'local',
    identity: '专注前端界面实现，承接组件开发与页面构建。',
    principles: ['增量交付', '小步迭代'],
    usage_modes: ['裸用'],
    kind: 'flow-owner',
    level: 'L2',
    brief: '前端开发员工',
    version: '0.1.0',
    redlines: [],
    deny: [],
    tier: '编码档',
    governanceLevel: 'L1',
    visibility: 'team',
    audit: 'exceptions-only',
    connectors: [],
    skills: [],
    selectedTemplateId: null,
  }
}

/** generate 200 响应 payload */
const GEN_OK = {
  package_path: '/path/to/employees/frontend-dev',
  files: ['AGENTS.md', 'manifest.yml', 'skills/tdd/SKILL.md'],
  manifest: { id: 'frontend-dev', display: '前端开发' },
}

describe('api/employees.ts（fetch 包装）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('generateEmployee：POST /api/employees/generate body {draft:{manifest, skills}} → 200 数据', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => GEN_OK,
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const draft = goodDraft()
    const out = await generateEmployee(draft)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/employees/generate')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as {
      draft: { manifest: Record<string, unknown>; skills: unknown[] }
    }
    expect(body.draft.manifest).toBeDefined()
    expect(body.draft.manifest).toMatchObject({ id: 'frontend-dev', display: '前端开发' })
    expect(Array.isArray(body.draft.skills)).toBe(true)
    expect(out).toMatchObject({ package_path: expect.any(String), files: expect.any(Array) })
  })

  it('generateEmployee：422 VALIDATION_FAILED → 抛 {code:"VALIDATION_FAILED", field_errors}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 'VALIDATION_FAILED', field_errors: [{ step: 2, field: 'display', message: '必填' }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const err = await generateEmployee(goodDraft()).catch((e) => e)
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(err.field_errors).toBeDefined()
  })

  it('generateEmployee：409 ID_CONFLICT → 抛 {code:"ID_CONFLICT"}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'ID_CONFLICT', message: 'id 已被占用' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const err = await generateEmployee(goodDraft()).catch((e) => e)
    expect(err).toMatchObject({ code: 'ID_CONFLICT' })
  })

  it('generateEmployee：422 SKILL_MISSING → 抛 {code:"SKILL_MISSING"}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 'SKILL_MISSING', message: 'skill 素材缺失：my-skill' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const err = await generateEmployee(goodDraft()).catch((e) => e)
    expect(err).toMatchObject({ code: 'SKILL_MISSING' })
  })

  it('validateId：GET /api/employees/validate-id?id= → {available, suggestion?}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ available: false, suggestion: 'frontend-dev-2' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const out = await validateId('frontend-dev')
    expect(fetchMock).toHaveBeenCalledWith('/api/employees/validate-id?id=frontend-dev')
    expect(out).toMatchObject({ available: false, suggestion: 'frontend-dev-2' })
  })

  it('saveAsTemplate：POST /api/templates body {id, manifest, skills}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'tpl-frontend', display: '前端开发' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const draft = goodDraft()
    const out = await saveAsTemplate(draft)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/templates')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as {
      id: string
      manifest: Record<string, unknown>
      skills: unknown[]
    }
    expect(body.id).toBe('frontend-dev')
    expect(body.manifest).toMatchObject({ id: 'frontend-dev', display: '前端开发' })
    expect(Array.isArray(body.skills)).toBe(true)
    expect(out).toMatchObject({ id: 'tpl-frontend' })
  })
})

describe('CreateWizard 生成动作（最后步「生成员工包」按钮 → generate 三态）', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function mountWizardToStep7() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    vi.mocked(fetchTemplates).mockResolvedValue([])
    vi.mocked(fetchSkills).mockResolvedValue([])
    const wrapper = mount(CreateWizard, { global: { plugins: [pinia, router] } })
    await flushPromises()
    const store = useWizardStore()
    Object.assign(store.draft, goodDraft())
    store.gotoStep(7)
    await flushPromises()
    return { wrapper, store, router }
  }

  it('step7 底部「生成员工包」按钮在位', async () => {
    const { wrapper } = await mountWizardToStep7()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    expect(btn, '生成员工包按钮应存在').toBeTruthy()
  })

  it('generate 200 → CompletionPanel 渲染 files 清单 + 三动作按钮在位 + 清草稿键', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => GEN_OK,
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await mountWizardToStep7()
    // 设置草稿键
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...goodDraft() }))
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()
    // CompletionPanel 渲染
    const text = wrapper.text()
    expect(text).toContain('/path/to/employees/frontend-dev')
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('manifest.yml')
    // 三动作按钮
    expect(wrapper.findAll('button').some((b) => b.text().includes('安装到底座'))).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text().includes('保存为角色模板'))).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text().includes('完成离开'))).toBe(true)
    // 草稿键已清
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('generate 422 VALIDATION_FAILED → 跳到第一个 issue 的 step（step2）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        code: 'VALIDATION_FAILED',
        field_errors: [{ step: 2, field: 'display', message: '必填' }],
      }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, store } = await mountWizardToStep7()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()
    expect(store.currentStep).toBe(2)
  })

  it('generate 409 ID_CONFLICT → id 输入区红字提示 + gotoStep(2)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'ID_CONFLICT', message: 'id 已被占用' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, store } = await mountWizardToStep7()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()
    expect(store.currentStep).toBe(2)
    expect(wrapper.text()).toContain('ID 已被占用')
  })

  it('generate 422 SKILL_MISSING → toast 错误信息（提示重传）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: 'SKILL_MISSING', message: 'skill 素材缺失：my-skill' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await mountWizardToStep7()
    const btn = wrapper.findAll('button').find((b) => b.text().includes('生成员工包'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('skill 素材缺失')
  })

  it('禁词红线：UI 文案不含「底座」「安装」「AgentHub」（除完成态显式动作外）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => GEN_OK,
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await mountWizardToStep7()
    // 未生成态——不应出现「安装到底座」字样（仅在完成态显示）
    const text = wrapper.text()
    expect(text).not.toContain('AgentHub')
    // 完成态前的 step7 不应出现「安装到底座」（按钮文案在生成成功后才显）
    // 此处检查 step7 默认态——不应有「安装到底座」
    expect(text).not.toContain('安装到底座')
  })
})

describe('CompletionPanel 三动作', () => {
  function mountCompletion(overrides: { packagePath?: string; files?: string[] } = {}) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWizardStore()
    Object.assign(store.draft, goodDraft())
    const router = makeRouter()
    const wrapper = mount(CompletionPanel, {
      global: { plugins: [pinia, router] },
      props: {
        packagePath: overrides.packagePath ?? '/path/to/employees/frontend-dev',
        files: overrides.files ?? ['AGENTS.md', 'manifest.yml'],
      },
    })
    return { wrapper, store, router }
  }

  it('包路径 + files 清单渲染', () => {
    const { wrapper } = mountCompletion({
      packagePath: '/path/to/employees/frontend-dev',
      files: ['AGENTS.md', 'manifest.yml', 'skills/tdd/SKILL.md'],
    })
    const text = wrapper.text()
    expect(text).toContain('/path/to/employees/frontend-dev')
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('manifest.yml')
    expect(text).toContain('skills/tdd/SKILL.md')
  })

  it('三动作按钮在位：安装到底座 / 保存为角色模板 / 完成离开', () => {
    const { wrapper } = mountCompletion()
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels.some((l) => l.includes('安装到底座'))).toBe(true)
    expect(labels.some((l) => l.includes('保存为角色模板'))).toBe(true)
    expect(labels.some((l) => l.includes('完成离开'))).toBe(true)
  })
})

describe('保存为角色模板 + 完成离开', () => {
  beforeEach(() => {
    vi.mocked(fetchTemplates).mockReset()
    vi.mocked(fetchSkills).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('保存模板：404 → toast「保存模板服务未就绪」', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'NOT_FOUND' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWizardStore()
    Object.assign(store.draft, goodDraft())
    const router = makeRouter()
    const wrapper = mount(CompletionPanel, {
      global: { plugins: [pinia, router] },
      props: { packagePath: '/p', files: ['AGENTS.md'] },
    })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('保存为角色模板'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存模板服务未就绪')
  })

  it('完成离开 → clearDraft 调用 + router.push("/employees")', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWizardStore()
    Object.assign(store.draft, goodDraft())
    const router = makeRouter()
    const pushSpy = vi.spyOn(router, 'push')
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...goodDraft() }))
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    const wrapper = mount(CompletionPanel, {
      global: { plugins: [pinia, router] },
      props: { packagePath: '/p', files: ['AGENTS.md'] },
    })
    const btn = wrapper.findAll('button').find((b) => b.text().includes('完成离开'))
    await btn!.trigger('click')
    await flushPromises()
    expect(pushSpy).toHaveBeenCalledWith('/employees')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })
})
