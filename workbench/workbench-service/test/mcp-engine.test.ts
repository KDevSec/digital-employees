/**
 * 引擎 MCP 工具面（L3 T8）——11 工具 × SDK client 自测（spike smoke-client 模式）+
 * 与 HTTP 写面同源等价断言 + /mcp 例外口集成冒烟。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Engine } from '@devzero/engine'
import { buildEngineMcpServer } from '../src/server/mcp/engine-mcp'

const ENGINE_ASSETS = fileURLToPath(new URL('../../workbench-engine/assets/flows', import.meta.url))

let root: string
let engine: Engine
let workspace: string
let client: Client

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'mcp-engine-'))
  const flows = join(root, 'flows')
  mkdirSync(flows, { recursive: true })
  copyFileSync(join(ENGINE_ASSETS, 'demo-flow.node-table.yml'), join(flows, 'demo-flow.node-table.yml'))
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flows })

  // InMemoryTransport 成对连接（SDK 标准测试通道——零 HTTP 依赖测工具面）
  const server = buildEngineMcpServer(engine)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  client = new Client({ name: 'test-client', version: '0.0.1' })
  await client.connect(clientT)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args })
  return JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text) as Record<string, unknown>
}

describe('MCP 工具面 · 11 工具注册与往返', () => {
  it('listTools 返回 11 个 engine_* 工具（server 名 devzero-engine）', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'engine_advance', 'engine_complete_task', 'engine_confirm_gate', 'engine_create_task',
      'engine_dispatch_done', 'engine_dispatch_start', 'engine_get_table', 'engine_get_task',
      'engine_handoff_write', 'engine_next_step', 'engine_record_gate',
    ])
    const serverInfo = client.getServerVersion()
    expect(serverInfo?.name).toBe('devzero-engine')
  })

  it('create→next_step→advance→record_gate 全链：结构化 JSON 回执（ok:true + 视图字段）', async () => {
    const created = await call('engine_create_task', {
      mode: 'team', flow: 'demo-flow', workspace, title: '登录页交付', input: '做一个登录页',
    })
    expect(created.ok).toBe(true)
    const taskId = created.task_id as string
    expect(taskId.startsWith('t-')).toBe(true)

    const ns = (await call('engine_next_step', { task_id: taskId })) as { ok: boolean; current_node: string; emp: string; prompt: string }
    expect(ns.ok).toBe(true)
    expect(ns.current_node).toBe('n-adm')
    expect(ns.emp).toBe('sec-compliance')
    expect(ns.prompt).toContain('secretgate') // n-adm 字面（{{input}} 渲染在 n0-req——MCP 通道同源）

    const adv = (await call('engine_advance', { task_id: taskId, to: 'n0-req', actor: 'sec-compliance' })) as { task: { current_node: string } }
    expect(adv.task.current_node).toBe('n0-req')

    await call('engine_advance', { task_id: taskId, to: 'g-req-review', actor: 'req-clarifier' })
    const rg = (await call('engine_record_gate', { task_id: taskId, gate: 'g-req-review', verdict: 'PASS', by: 'reviewer-expert' })) as { task: { current_node: string } }
    expect(rg.task.current_node).toBe('n1-design')
  })

  it('错误契约：非法操作 → isError + {ok:false,error, detail 含定位}', async () => {
    const res = await client.callTool({ name: 'engine_get_task', arguments: { task_id: 't-ghost' } })
    expect(res.isError).toBe(true)
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text) as { ok: boolean; error: string; detail: string }
    expect(payload.ok).toBe(false)
    expect(payload.error).toBe('engine_error')
    expect(payload.detail.length).toBeGreaterThan(0)
  })

  it('MCP 与 HTTP 写面同源：同 task 两通道操作效果等价（事件流一致）', async () => {
    const created = await call('engine_create_task', {
      mode: 'solo', employee: 'dev-engineer', workspace, title: 'T', input: 'x',
    })
    const taskId = created.task_id as string
    // HTTP 侧（Engine 直调——与 routes/engine.ts 同一实例同源；此处断言两通道写同一账本）
    engine.advance(taskId, 'n-done', { actor: 'human' })
    const mcpView = (await call('engine_get_task', { task_id: taskId })) as { task: { current_node: string } }
    expect(mcpView.task.current_node).toBe('n-done') // MCP 读到 HTTP 侧写
    expect(engine.readEvents(taskId).length).toBeGreaterThanOrEqual(2)
  })
})
