/**
 * spike 共享工具面——贴 D-037 模式一语义（advance / record-gate），
 * 但只是 echo 级模拟（内存计数器），不实现任何引擎逻辑（spike 纪律）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/** 假账本：只计数不做状态机——够验证「底座→工具→返回」链路即可 */
const calls: string[] = []

export function registerSpikeTools(server: McpServer, mode: string): void {
  server.registerTool(
    'spike_echo',
    {
      title: 'Spike Echo',
      description: '最小往返验证：原样返回 message（带形态标记）',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `[${mode}] echo: ${message}` }],
    }),
  )

  server.registerTool(
    'spike_advance',
    {
      title: 'Spike Advance（模拟）',
      description: '模拟 D-037 员工回报推进：接收 run_id/node_id/result，返回受理序号（假账本）',
      inputSchema: {
        run_id: z.string(),
        node_id: z.string(),
        result: z.enum(['done', 'fail']),
      },
    },
    async ({ run_id, node_id, result }) => {
      calls.push(`advance:${run_id}/${node_id}/${result}`)
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, seq: calls.length, mode, run_id, node_id, result }) },
        ],
      }
    },
  )

  server.registerTool(
    'spike_record_gate',
    {
      title: 'Spike Record Gate（模拟）',
      description: '模拟安全闸回报：接收 run_id/gate/verdict，返回受理序号（假账本）',
      inputSchema: {
        run_id: z.string(),
        gate: z.string(),
        verdict: z.enum(['pass', 'fail']),
      },
    },
    async ({ run_id, gate, verdict }) => {
      calls.push(`gate:${run_id}/${gate}/${verdict}`)
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, seq: calls.length, mode, run_id, gate, verdict }) },
        ],
      }
    },
  )
}
