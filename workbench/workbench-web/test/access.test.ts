import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enrollAction,
  fetchAccessState,
  logoutAction,
  parseStateJson,
  progressAction,
  resetAction,
  statusBadgeClass,
  statusLabel,
  type ActionResult,
} from '../src/api/access'

/**
 * F-03 纯函数层（I0-5 T2，设计 §3 迁移映射）：statusLabel/statusBadgeClass/parseStateJson
 * 语义唯一权威 = workbench-demo/src/ui.ts（L25 状态映射）+ server.ts L146-162（/api/state 响应形状）。
 * 本文件为 node 纯逻辑环境（无 jsdom 头注释，D-10 环境分流），fetch 以 stubGlobal 顶替。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  }
}

describe('statusLabel（demo ui.ts L25 八状态中文映射原样照搬，未知值原样返回）', () => {
  it.each([
    ['NEW', '未提交'],
    ['PENDING_REVIEW', '待审批'],
    ['APPROVED', '已批准待激活'],
    ['COMPLETED', '已完成注册'],
    ['ACTIVE', '已激活'],
    ['REJECTED', '已拒绝'],
    ['REVOKED', '已吊销'],
    ['ERROR', '提交失败'],
  ])('%s → %s', (status, label) => {
    expect(statusLabel(status)).toBe(label)
  })

  it('未知状态原样返回（demo `||status` 分支）', () => {
    expect(statusLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE')
  })
})

describe('statusBadgeClass（demo badge CSS 类语义等价迁移）', () => {
  it.each([
    ['ACTIVE', 'ok'],
    ['PENDING_REVIEW', 'pending'],
    ['APPROVED', 'pending'],
    ['COMPLETED', 'pending'],
    ['REJECTED', 'error'],
    ['ERROR', 'error'],
    ['REVOKED', 'error'],
    ['NEW', 'neutral'],
  ])('%s → %s', (status, cls) => {
    expect(statusBadgeClass(status)).toBe(cls)
  })

  it('未知状态 → neutral（demo 默认灰底徽章兜底）', () => {
    expect(statusBadgeClass('WEIRD')).toBe('neutral')
  })
})

describe('parseStateJson（外部对象不可信容错，沿 api/health.ts 先例）', () => {
  it('完整合法对象（demo server.ts L160 形状）→ 解析为 AccessState，剥离 privateJwk/publicJwk 等多余字段', () => {
    const data = {
      installationId: 'inst-001',
      privateJwk: { kty: 'EC' },
      publicJwk: { kty: 'EC' },
      enrollmentId: 'enr-9',
      workbenchId: 'wb-7',
      status: 'PENDING_REVIEW',
      lastHeartbeatAt: '2026-08-25T10:00:00Z',
      rejectionReason: undefined,
      error: undefined,
      authenticated: true,
      user: { name: '张三', preferred_username: 'zhangsan', email: 'z@corp.example', iss: 'https://kc' },
    }
    expect(parseStateJson(data)).toStrictEqual({
      installationId: 'inst-001',
      enrollmentId: 'enr-9',
      workbenchId: 'wb-7',
      status: 'PENDING_REVIEW',
      lastHeartbeatAt: '2026-08-25T10:00:00Z',
      rejectionReason: undefined,
      error: undefined,
      authenticated: true,
      user: { name: '张三', preferred_username: 'zhangsan', email: 'z@corp.example' },
    })
  })

  it('非对象输入（null / 数组 / 字符串 / 数字）→ null', () => {
    expect(parseStateJson(null)).toBeNull()
    expect(parseStateJson([])).toBeNull()
    expect(parseStateJson('nope')).toBeNull()
    expect(parseStateJson(42)).toBeNull()
  })

  it('installationId 缺失或非字符串 → null（根标识缺失说明响应形状根本不对，整包拒绝走不可达路径）', () => {
    expect(parseStateJson({ status: 'ACTIVE', authenticated: true })).toBeNull()
    expect(parseStateJson({ installationId: 123, status: 'ACTIVE', authenticated: true })).toBeNull()
  })

  it('status 非法/缺失/类型错 → 归一 NEW（设计选择：局部损坏仍可渲染状态卡其余字段，枚举降级保守取初始态，不整包拒绝）', () => {
    expect(parseStateJson({ installationId: 'inst-1', status: 'NOT_A_STATUS', authenticated: true })?.status).toBe('NEW')
    expect(parseStateJson({ installationId: 'inst-1', authenticated: true })?.status).toBe('NEW')
    expect(parseStateJson({ installationId: 'inst-1', status: 7, authenticated: true })?.status).toBe('NEW')
  })

  it('authenticated 缺失/非布尔 → false（保守默认，不授予能力）', () => {
    expect(parseStateJson({ installationId: 'inst-1', status: 'ACTIVE' })?.authenticated).toBe(false)
    expect(parseStateJson({ installationId: 'inst-1', status: 'ACTIVE', authenticated: 'yes' })?.authenticated).toBe(false)
  })

  it('可选字符串字段类型错 → 归一 undefined（不透传原始值）；user 非对象 → undefined', () => {
    const parsed = parseStateJson({
      installationId: 'inst-1',
      status: 'ACTIVE',
      authenticated: true,
      enrollmentId: 99,
      workbenchId: false,
      lastHeartbeatAt: { t: 1 },
      rejectionReason: null,
      error: ['x'],
      user: '张三',
    })
    expect(parsed).toStrictEqual({
      installationId: 'inst-1',
      enrollmentId: undefined,
      workbenchId: undefined,
      status: 'ACTIVE',
      lastHeartbeatAt: undefined,
      rejectionReason: undefined,
      error: undefined,
      authenticated: true,
      user: undefined,
    })
  })

  it('user 只取 name/preferred_username/email 三个 claim，类型错的 claim 丢弃', () => {
    const parsed = parseStateJson({
      installationId: 'inst-1',
      status: 'ACTIVE',
      authenticated: true,
      user: { name: '李四', preferred_username: 1, email: 'l@corp.example', sub: 'ignored' },
    })
    expect(parsed?.user).toStrictEqual({ name: '李四', email: 'l@corp.example' })
  })
})

describe('fetchAccessState（同源 fetch /api/state，2s 超时/失败归一 null，沿 fetchHealthz 手法）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('成功 → parseStateJson 解析结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ installationId: 'inst-1', status: 'ACTIVE', authenticated: true })))
    await expect(fetchAccessState()).resolves.toStrictEqual({
      installationId: 'inst-1',
      enrollmentId: undefined,
      workbenchId: undefined,
      status: 'ACTIVE',
      lastHeartbeatAt: undefined,
      rejectionReason: undefined,
      error: undefined,
      authenticated: true,
      user: undefined,
    })
  })

  it('请求 /api/state（同源相对路径）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ installationId: 'inst-1', status: 'NEW', authenticated: false }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchAccessState()
    expect(fetchMock).toHaveBeenCalledWith('/api/state', expect.objectContaining({ signal: expect.anything() }))
  })

  it('非 2xx → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'boom' } }, { ok: false, status: 502, statusText: 'Bad Gateway' })))
    await expect(fetchAccessState()).resolves.toBeNull()
  })

  it('网络异常 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    await expect(fetchAccessState()).resolves.toBeNull()
  })

  it('响应体非 JSON → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => Promise.reject(new Error('not json')) })))
    await expect(fetchAccessState()).resolves.toBeNull()
  })

  it('2s 超时（挂起不响应）→ abort → null', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })))
    const pending = fetchAccessState()
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toBeNull()
  })
})

describe('动作端点集中调用（全 POST，按 demo server.ts 实证；G-2 矛盾已落档，A 系列裁决后单点改此处）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const actions: Record<string, () => Promise<ActionResult>> = {
    enrollAction,
      resetAction,
    logoutAction,
    progressAction,
  }

  it.each([
    ['enrollAction', '/api/enroll'],
    ['resetAction', '/api/reset'],
    ['logoutAction', '/api/logout'],
    ['progressAction', '/api/progress'],
  ])('%s → POST %s，成功 → {ok:true, message:操作成功}', async (name, path) => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await actions[name as keyof typeof actions]()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual({ ok: true, message: '操作成功' })
  })

  it('失败响应 → ok:false 且透传服务端 error.message（demo call() 语义）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'ENROLLMENT_NOT_FOUND', message: '请先提交接入申请' } }, { ok: false, status: 409, statusText: 'Conflict' })))
    await expect(progressAction()).resolves.toEqual({ ok: false, message: '请先提交接入申请' })
  })

  it('失败且无错误体 → 回退 statusText', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 502, statusText: 'Bad Gateway' })))
    await expect(enrollAction()).resolves.toEqual({ ok: false, message: 'Bad Gateway' })
  })

  it('网络异常（fetch 拒绝）→ ok:false 不抛出（demo 在此未捕获，SPA 侧统一归一为失败结果）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch failed')
    }))
    await expect(resetAction()).resolves.toEqual({ ok: false, message: 'fetch failed' })
  })
})
