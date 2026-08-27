/**
 * 引擎 MCP 工具面（L3 T8）——11 操作 × `engine_*` 工具（设计 §9.2 / 契约 §9.1）。
 * MCP server（devzero-engine）经 @hono/mcp StreamableHTTPTransport 挂 service /mcp（例外口见 hono-adapter）。
 * 工具入参 = zod raw shape（复用 HTTP 域同形校验）；返回 content:text 结构化 JSON——
 * {ok:true,…回执} / {ok:false,error,detail}（isError 标记），员工会话按 AGENTS.md SOP 读懂。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Engine } from '@devzero/engine'

/** 结构化文本返回（员工 LLM 可读的紧凑 JSON） */
function okText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}
function errText(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'engine_error', detail: message }) }],
  }
}

export function buildEngineMcpServer(engine: Engine): McpServer {
  const server = new McpServer({ name: 'devzero-engine', version: '0.0.1' })

  server.registerTool('engine_create_task', {
    title: '发起任务',
    description: '发起编排任务：team 模式选 flow 表，solo 模式单员工动态表。返回 {task_id}',
    inputSchema: {
      mode: z.enum(['team', 'solo']),
      flow: z.string().optional(),
      employee: z.string().optional(),
      workspace: z.string().describe('任务工作区绝对路径（产物落此）'),
      title: z.string(),
      input: z.string().describe('需求文本（节点指令 {{input}} 注入源）'),
      base: z.string().optional(), model: z.string().optional(), effort: z.string().optional(),
    },
  }, async (p) => { try { return okText({ ok: true, ...engine.createTask(p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_get_task', {
    title: '查任务状态',
    description: '任务状态视图（status/current_node/gate_iters/position 等）',
    inputSchema: { task_id: z.string() },
  }, async ({ task_id }) => { try { return okText({ ok: true, task: engine.getTask(task_id) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_next_step', {
    title: '下一步',
    description: '当前节点+可执行动作+gate_spec；action 节点带 emp 与渲染后 prompt——薄驱动核心读工具',
    inputSchema: { task_id: z.string() },
  }, async ({ task_id }) => { try { return okText({ ok: true, ...engine.nextStep(task_id) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_advance', {
    title: '推进节点',
    description: '员工自报节点推进（记账）。reflow 仅机械回流路径使用',
    inputSchema: {
      task_id: z.string(), to: z.string(),
      reflow: z.boolean().optional(), reason: z.string().optional(), actor: z.string().optional(),
    },
  }, async (p) => { try { return okText({ ok: true, task: engine.advance(p.task_id, p.to, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_record_gate', {
    title: '闸判定回报',
    description: '评审员工会话回报 verdict（review/acceptance: PASS|FAIL；decision: 分支键）',
    inputSchema: {
      task_id: z.string(), gate: z.string(), verdict: z.string(), by: z.string().describe('回报员工 id'),
      issues: z.array(z.string()).optional(), request_id: z.string().optional(),
    },
  }, async (p) => { try { return okText({ ok: true, task: engine.recordGate(p.task_id, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_dispatch_start', {
    title: '派发开始',
    description: '记录派发开始（驱动器或人）。返回 {dispatch_id}',
    inputSchema: { task_id: z.string(), emp: z.string(), node: z.string().optional(), prompt: z.string().optional() },
  }, async (p) => { try { return okText({ ok: true, ...engine.dispatchStart(p.task_id, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_dispatch_done', {
    title: '派发完成',
    description: '员工段结束回报（可带 usage）',
    inputSchema: {
      task_id: z.string(), emp: z.string(), dispatch_id: z.string(),
      status: z.enum(['done', 'blocked']).optional(), usage: z.record(z.number()).optional(),
    },
  }, async (p) => { try { return okText({ ok: true, task: engine.dispatchDone(p.task_id, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_handoff_write', {
    title: '写交接',
    description: '写交接产物摘要（handoffs/<emp>/<node>.handoff.json）。返回落盘 {path}',
    inputSchema: {
      task_id: z.string(), emp: z.string(), node: z.string(), summary: z.string().describe('一句话人可读信号'),
      artifacts: z.array(z.string()).optional(),
      status: z.enum(['done', 'blocked', 'needs_context']).optional(), reason: z.string().optional(),
    },
  }, async (p) => { try { return okText({ ok: true, ...engine.handoffWrite(p.task_id, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_confirm_gate', {
    title: '人工闸放行',
    description: '人工闸停靠放行（approve 推进 / reject 原地恢复）。actor=human 进流水',
    inputSchema: { task_id: z.string(), node: z.string(), verdict: z.enum(['approve', 'reject']), note: z.string().optional() },
  }, async (p) => { try { return okText({ ok: true, task: engine.confirmGate(p.task_id, p) }) } catch (e) { return errText(e) } })

  server.registerTool('engine_complete_task', {
    title: '收尾任务',
    description: '终态收尾（completed/aborted）+ 归档',
    inputSchema: { task_id: z.string(), status: z.enum(['completed', 'aborted']).optional() },
  }, async (p) => { try { return okText({ ok: true, task: engine.completeTask(p.task_id, p.status ?? 'completed') }) } catch (e) { return errText(e) } })

  server.registerTool('engine_get_table', {
    title: '读流程表',
    description: '任务表快照（节点链/gate_specs——员工程序化读表）',
    inputSchema: { task_id: z.string() },
  }, async ({ task_id }) => { try { return okText({ ok: true, table: engine.getTable(task_id) }) } catch (e) { return errText(e) } })

  return server
}
