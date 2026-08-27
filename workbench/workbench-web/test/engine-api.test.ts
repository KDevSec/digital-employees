// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskPayload, httpEngineApi } from '../src/api/engine-api'

/**
 * 引擎 HTTP 面（L5 看板线 T9；契约真源 = 协同编排设计 §9.3）：
 * 同源相对路径（health.ts 同款纪律）；fetch 失败归一错误不抛裸异常。
 * getTask 响应形状（含 table/employees）为契约歧义 A/B 的先行口径。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('httpEngineApi（真实 HTTP 实现，fetch 注入断言）', () => {
  it('createTask：POST /api/engine/tasks + 载荷逐字段（§9.1 参数面）→ 202 + task_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ task_id: 'R-1' }, 202))
    vi.stubGlobal('fetch', fetchMock)
    const payload = createTaskPayload({
      mode: 'team',
      flow: 'demo-flow',
      title: '支付网关对接',
      workspace: 'D:/demo',
      input: '需求文本',
      base: 'qoder',
      model: '编码档',
      effort: 'high',
    })
    const res = await httpEngineApi.createTask(payload)
    expect(res).toEqual({ task_id: 'R-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/engine/tasks')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('getTask：GET /api/engine/tasks/:id → task + table + employees', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ task: { task_id: 'R-1' }, table: { flow: 'demo-flow', nodes: [] }, employees: { 'sec-compliance': '安全合规审核员' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await httpEngineApi.getTask('R-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/engine/tasks/R-1')
    expect(res.table.flow).toBe('demo-flow')
    expect(res.employees['sec-compliance']).toBe('安全合规审核员')
  })

  it('getFlows：GET /api/engine/flows → 拆包 {ok,flows} 信封取数组（引擎真实响应形状，L5×L3 联调实锤）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, flows: [{ flow: 'demo-flow', file: 'demo-flow.node-table.yml' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const flows = await httpEngineApi.getFlows()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/engine/flows')
    expect(Array.isArray(flows)).toBe(true)
    expect(flows[0].flow).toBe('demo-flow')
    expect(flows.length).toBe(1)
  })

  it('confirmGate：POST /api/engine/tasks/:id/confirm-gate 带 node/verdict（人工闸辅通道）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await httpEngineApi.confirmGate('R-1', 'n0-req', 'approve')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/engine/tasks/R-1/confirm-gate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ node: 'n0-req', verdict: 'approve' })
  })

  it('非 2xx / 网络失败：reject 带 Error（不吞错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '员工未安装' }, 400)))
    await expect(httpEngineApi.getFlows()).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    await expect(httpEngineApi.getFlows()).rejects.toThrow()
  })
})
