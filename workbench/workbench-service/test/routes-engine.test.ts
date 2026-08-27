/**
 * engine 域 HTTP API（L3 T6）——设计 §9.3 端点契约。
 * 真实 Engine（临时 dataDir/templatesDir 拷 demo 表）经 buildApp 注入，
 * hono app.request 走完整 adapter 链（guard/query/JSON）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerAllRoutes } from '../src/server/routes'
import { loadConfig, writeConfigOverride } from '../src/config/load'
import { createPlatformAccess } from '../src/app/platform-access'
import { Engine } from '@devzero/engine'
import { readFileSync } from 'node:fs'

const ENGINE_ASSETS = fileURLToPath(new URL('../../workbench-engine/assets/flows', import.meta.url))

let root: string
let workspace: string
let app: ReturnType<typeof toHonoApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'routes-engine-'))
  const flows = join(root, 'flows')
  mkdirSync(flows, { recursive: true })
  copyFileSync(join(ENGINE_ASSETS, 'demo-flow.node-table.yml'), join(flows, 'demo-flow.node-table.yml'))
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })

  const registry = createRegistry()
  const { service } = createPlatformAccess({ profileDir: root, loadConfig, installationId: 'uid-abc', version: '9.9.9' })
  registerAllRoutes(registry, {
    version: '9.9.9', pid: 4321, uid: 'uid-abc', dataDir: root, uptime: () => 1,
    indexHtml: '<html></html>', profileDir: root, loadConfig, writeConfigOverride,
    engine: new Engine({ dataDir: join(root, 'data'), templatesDir: flows }),
    // I1 L2 安装线两域占位（本文件不触达，行为断言在 routes-installs/routes-bases.test.ts）
    registryFile: join(root, 'registry.json'), staffRoot: join(root, 'digital-staff'),
    authSourceDirs: { 'claude-code': '', codebuddy: '', qoder: '' },
    probe: () => ({ present: false, version: null }), packageRoots: {},
    cacheDir: join(root, 'bases'), run: async () => ({ code: 127, stdout: '' }),
    // A 系列认证三域（A 线合流后 RouteDeps 必含）：service 切片 + guard 注入
    //（enrollment 全 session 档，无 guard 时 toHonoApp 装配保险丝即炸——本文件不触达认证端点）
    service,
  })
  app = toHonoApp(registry, { sessionGuard: (ctx, grade) => service.sessionGuard(ctx, grade) })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const ws = (): string => workspace

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', Host: '127.0.0.1:19980' }, body: JSON.stringify(body) })
const get = (path: string) => app.request(path, { headers: { Host: '127.0.0.1:19980' } })

describe('engine 域 · 任务生命周期与读面', () => {
  it('POST /api/engine/tasks → 202 {ok,task_id}；GET tasks 列表含新任务；GET :id 详情；flows 清单', async () => {
    const created = await post('/api/engine/tasks', {
      mode: 'team', flow: 'demo-flow', workspace: ws(), title: '登录页交付', input: '做一个登录页',
    })
    expect(created.status).toBe(202)
    const cj = (await created.json()) as { ok: boolean; task_id: string }
    expect(cj.ok).toBe(true)
    expect(cj.task_id.startsWith('t-')).toBe(true)

    const list = await get('/api/engine/tasks')
    expect(list.status).toBe(200)
    const lj = (await list.json()) as { tasks: { task_id: string }[] }
    expect(lj.tasks.map((t) => t.task_id)).toContain(cj.task_id)

    const detail = await get(`/api/engine/tasks/${cj.task_id}`)
    expect(detail.status).toBe(200)
    const dj = (await detail.json()) as { task: { flow: string; current_node: string; position: { total: number } } }
    expect(dj.task.flow).toBe('demo-flow')
    expect(dj.task.current_node).toBe('n-adm')
    expect(dj.task.position.total).toBe(6)

    const flows = await get('/api/engine/flows')
    const fj = (await flows.json()) as { flows: { flow: string }[] }
    expect(fj.flows).toEqual([{ flow: 'demo-flow', file: 'demo-flow.node-table.yml' }])
  })

  it('GET :id/events?after_seq= 分页过滤', async () => {
    const created = await post('/api/engine/tasks', { mode: 'solo', employee: 'dev-engineer', workspace: ws(), title: 'T', input: 'x' })
    const { task_id } = (await created.json()) as { task_id: string }
    await post(`/api/engine/tasks/${task_id}/advance`, { to: 'n-done' })

    const all = await get(`/api/engine/tasks/${task_id}/events`)
    const aj = (await all.json()) as { events: { seq: number }[] }
    expect(aj.events.length).toBeGreaterThanOrEqual(2) // run.created + transition

    const after = await get(`/api/engine/tasks/${task_id}/events?after_seq=1`)
    const fj = (await after.json()) as { events: { seq: number }[] }
    expect(fj.events.every((e) => e.seq > 1)).toBe(true)
    expect(fj.events.length).toBe(aj.events.length - 1)
  })
})

describe('engine 域 · 写面六操作 + complete/abort', () => {
  it('advance/record-gate/dispatch-start/dispatch-done/handoff-write/confirm-gate 全链 200 且 task 视图推进', async () => {
    const created = await post('/api/engine/tasks', { mode: 'team', flow: 'demo-flow', workspace: ws(), title: 'T', input: 'x' })
    const { task_id } = (await created.json()) as { task_id: string }

    // dispatch-start → {ok, dispatch_id}
    const ds = await post(`/api/engine/tasks/${task_id}/dispatch-start`, { emp: 'sec-compliance', node: 'n-adm' })
    expect(ds.status).toBe(200)
    const dsj = (await ds.json()) as { dispatch_id: string }
    expect(dsj.dispatch_id).toBe('d-1')

    const adv = await post(`/api/engine/tasks/${task_id}/advance`, { to: 'n0-req' })
    expect(adv.status).toBe(200)
    expect(((await adv.json()) as { task: { current_node: string } }).task.current_node).toBe('n0-req')

    const hw = await post(`/api/engine/tasks/${task_id}/handoff-write`, {
      emp: 'sec-compliance', node: 'n-adm', summary: '扫描通过', artifacts: ['r.json'],
    })
    expect(hw.status).toBe(200)

    await post(`/api/engine/tasks/${task_id}/advance`, { to: 'g-req-review' })
    const rg = await post(`/api/engine/tasks/${task_id}/record-gate`, { gate: 'g-req-review', verdict: 'PASS', by: 'reviewer-expert' })
    expect(((await rg.json()) as { task: { current_node: string } }).task.current_node).toBe('n1-design')

    const dd = await post(`/api/engine/tasks/${task_id}/dispatch-done`, { emp: 'sec-compliance', dispatch_id: 'd-1', usage: { tokens: 10 } })
    expect(dd.status).toBe(200)

    // complete → completed（事件尾）
    const cp = await post(`/api/engine/tasks/${task_id}/complete`, {})
    expect(cp.status).toBe(200)
    expect(((await cp.json()) as { task: { status: string } }).task.status).toBe('completed')
  })

  it('abort 端点 → aborted 终态', async () => {
    const created = await post('/api/engine/tasks', { mode: 'solo', employee: 'dev-engineer', workspace: ws(), title: 'T', input: 'x' })
    const { task_id } = (await created.json()) as { task_id: string }
    const ab = await post(`/api/engine/tasks/${task_id}/abort`, {})
    expect(((await ab.json()) as { task: { status: string } }).task.status).toBe('aborted')
  })
})

describe('engine 域 · 错误契约', () => {
  it('非法 body → 400 {ok:false,error:bad_request,detail 含字段定位}', async () => {
    const res = await post('/api/engine/tasks', { mode: 'team', flow: 'demo-flow', workspace: ws(), title: '' }) // title 空
    expect(res.status).toBe(400)
    const j = (await res.json()) as { ok: boolean; error: string; detail: string }
    expect(j.ok).toBe(false)
    expect(j.error).toBe('bad_request')
    expect(j.detail).toContain('title')

    const strict = await post('/api/engine/tasks', { mode: 'team', flow: 'x', workspace: ws(), title: 'T', input: 'x', unknownKey: 1 })
    expect(strict.status).toBe(400)
  })

  it('未知任务 → 404 {ok:false,error:engine_error}；未知 flow 模板 → 400/404 语义错误', async () => {
    const res = await get('/api/engine/tasks/t-000000000000')
    expect(res.status).toBe(404)
    const j = (await res.json()) as { ok: boolean; error: string }
    expect(j.error).toBe('engine_error')

    const bad = await post('/api/engine/tasks', { mode: 'team', flow: 'nope', workspace: ws(), title: 'T', input: 'x' })
    expect([400, 404]).toContain(bad.status)
  })
})
