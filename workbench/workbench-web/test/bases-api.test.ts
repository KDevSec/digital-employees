import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBases, fetchModels, installBase, probeBases, fetchTierMap, saveTierMap, modelSelectFromResult, shouldFetchCliModels, cliSelectAfterFetch } from '../src/api/bases'

/**
 * 底座 API（D-bb01）：GET /api/bases、POST probe、GET models、POST install。
 * 形状沿 api/platform-config.ts：同源相对路径 + 超时 + 失败归一，不抛出。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  }
}

describe('fetchBases（GET /api/bases）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功 → 卡片数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { id: 'codebuddy', label: 'CodeBuddy', present: false, version: null, employees_count: 3 },
      { id: 'qoder', label: 'Qoder', present: true, version: '1.1.31', employees_count: 0 },
    ])))
    const cards = await fetchBases()
    expect(cards).toHaveLength(2)
    expect(cards?.[0].id).toBe('codebuddy')
  })

  it('请求 GET /api/bases', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await fetchBases()
    expect(fetchMock).toHaveBeenCalledWith('/api/bases', expect.objectContaining({ signal: expect.anything() }))
  })

  it('非 2xx / 网络异常 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 500 })))
    await expect(fetchBases()).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(fetchBases()).resolves.toBeNull()
  })
})

describe('fetchModels（GET /api/bases/:id/models；未登录 ≠ 空列表）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 → { ok:true, models }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ id: 'auto', label: 'auto' }])))
    await expect(fetchModels('qoder')).resolves.toEqual({
      ok: true,
      models: [{ id: 'auto', label: 'auto' }],
    })
  })

  it('403 NOT_LOGGED_IN → 可区分错误，不是空 models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { code: 'NOT_LOGGED_IN', message: '登录后可见' } },
      { ok: false, status: 403 },
    )))
    const result = await fetchModels('qoder')
    expect(result).toEqual({ ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' })
  })
})

describe('shouldFetchCliModels（任务表单：只拉已登记 CLI 模型的底座）', () => {
  it('Qoder / CodeBuddy 拉 CLI；claude-code 不把档位桩当 CLI 真模型', () => {
    expect(shouldFetchCliModels('qoder')).toBe(true)
    expect(shouldFetchCliModels('codebuddy')).toBe(true)
    expect(shouldFetchCliModels('claude-code')).toBe(false)
    expect(shouldFetchCliModels('')).toBe(false)
  })
})

describe('modelSelectFromResult（发起任务联动）', () => {
  it('未登录 → 提示登录后可见、模型选项为空（≠ 无模型）', () => {
    expect(modelSelectFromResult({ ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' })).toEqual({
      hint: '登录后可见',
      models: [],
    })
  })

  it('已登录 → 真实模型进下拉', () => {
    expect(modelSelectFromResult({ ok: true, models: [{ id: 'auto', label: 'auto' }] }).models).toEqual([
      { id: 'auto', label: 'auto' },
    ])
  })
})

describe('cliSelectAfterFetch（切底座：过期探测丢弃，避免 CLI id 残留到下一底座）', () => {
  it('请求底座已不是当前底座 → null，调用方不得回填下拉', () => {
    expect(cliSelectAfterFetch(
      'qoder',
      'claude-code',
      { ok: true, models: [{ id: 'auto', label: 'auto' }] },
    )).toBeNull()
  })

  it('仍是同一底座 → 采纳结果', () => {
    expect(cliSelectAfterFetch(
      'qoder',
      'qoder',
      { ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' },
    )).toEqual({ hint: '登录后可见', models: [] })
  })
})

describe('installBase（POST /api/bases/:id/install）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功 → logs + presence；POST 到登记路径', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      logs: 'added 1 package\n',
      presence: { present: true, version: '2.137.1', probed_at: 't' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await installBase('codebuddy')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bases/codebuddy/install',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.logs).toContain('added 1 package')
  })

  it('502 NPM_INSTALL_FAILED 带 logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { code: 'NPM_INSTALL_FAILED', message: '失败' }, logs: 'npm ERR!\n' },
      { ok: false, status: 502 },
    )))
    const result = await installBase('codebuddy')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NPM_INSTALL_FAILED')
      expect(result.logs).toContain('npm ERR!')
    }
  })
})

describe('probeBases（POST /api/bases/probe）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST /api/bases/probe 空 body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await probeBases()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bases/probe',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('fetchTierMap / saveTierMap（GET/PUT /api/bases/:id/tiers）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET 200 → 五档表', async () => {
    const map = {
      评审安全档: '',
      设计档: 'hy3',
      探索档: '',
      编码档: 'gone-id',
      执行档: '',
    }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(map)))
    await expect(fetchTierMap('codebuddy')).resolves.toEqual(map)
  })

  it('GET 非 2xx / 网络异常 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 500 })))
    await expect(fetchTierMap('qoder')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(fetchTierMap('qoder')).resolves.toBeNull()
  })

  it('PUT 五档到 /api/bases/:id/tiers', async () => {
    const map = {
      评审安全档: '',
      设计档: '',
      探索档: '',
      编码档: 'auto',
      执行档: '',
    }
    const fetchMock = vi.fn(async () => jsonResponse(map))
    vi.stubGlobal('fetch', fetchMock)
    await expect(saveTierMap('qoder', map)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bases/qoder/tiers',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(map),
      }),
    )
  })
})
