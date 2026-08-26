/**
 * SDK client 自测（不依赖底座——先证 Bun 起 MCP server 两形态本身可行，再上真机）：
 *  stdio：spawn 子进程 → initialize → listTools → callTool ×3 → close
 *  http：spawn http-server → 等 healthz → StreamableHTTPClientTransport 连 /mcp → 同上
 * 退出码 0 = 全绿；任一 FAIL = 1。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { spawn } from 'node:child_process'

const BUN = process.execPath
const HERE = import.meta.dir
const HTTP_PORT = Number(process.env.SPIKE_PORT ?? 29980)

let failed = 0
function check(label: string, cond: boolean, detail?: string): void {
  if (!cond) failed++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as { type: string; text?: string }[] | undefined
  return content?.[0]?.text ?? ''
}

async function exercise(client: Client, mode: string): Promise<void> {
  const tools = await client.listTools()
  const names = tools.tools.map((t) => t.name)
  check(
    `${mode}: listTools 返回 3 个工具`,
    names.length === 3 && ['spike_echo', 'spike_advance', 'spike_record_gate'].every((n) => names.includes(n)),
    names.join(', '),
  )

  const echo = await client.callTool({ name: 'spike_echo', arguments: { message: 'hello-from-smoke' } })
  check(`${mode}: callTool spike_echo 往返`, firstText(echo).includes('echo: hello-from-smoke'), firstText(echo))

  const adv = await client.callTool({ name: 'spike_advance', arguments: { run_id: 'run-1', node_id: 'n-dev', result: 'done' } })
  check(`${mode}: callTool spike_advance 受理`, firstText(adv).includes('"ok":true') && firstText(adv).includes('run-1'), firstText(adv))

  const gate = await client.callTool({ name: 'spike_record_gate', arguments: { run_id: 'run-1', gate: 'sec-review', verdict: 'pass' } })
  check(`${mode}: callTool spike_record_gate 受理`, firstText(gate).includes('"ok":true') && firstText(gate).includes('sec-review'), firstText(gate))
}

async function waitHttpUp(port: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`)
      if (res.ok) return true
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function main(): Promise<void> {
  console.log('=== Q1a stdio 形态（McpServer + StdioServerTransport，Bun 直跑 TS） ===')
  {
    const client = new Client({ name: 'smoke-client', version: '0.0.0' })
    const transport = new StdioClientTransport({ command: BUN, args: [`${HERE}/stdio-server.ts`] })
    await client.connect(transport)
    await exercise(client, 'stdio')
    await client.close()
  }

  console.log('=== Q1b http 形态（hono 挂 /mcp + Bun.serve + @hono/mcp） ===')
  const server = spawn(BUN, [`${HERE}/http-server.ts`], { stdio: ['ignore', 'inherit', 'inherit'] })
  try {
    const up = await waitHttpUp(HTTP_PORT)
    check('http: server 起活（healthz 200）', up)

    const client = new Client({ name: 'smoke-client', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${HTTP_PORT}/mcp`))
    await client.connect(transport)
    await exercise(client, 'http')
    await client.close()
  } finally {
    server.kill()
  }

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('smoke-client crashed:', err)
  process.exit(1)
})
