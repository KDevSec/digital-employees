/**
 * Q1b：HTTP Streamable 形态 MCP server——hono 挂 /mcp 路由 + Bun.serve。
 * 与 workbench-service 现状同构（main.ts: Bun.serve({ fetch: app.fetch })，
 * registry.ts/hono-adapter.ts 的路由表形态 spike 内从简）。
 * 端口 29980：避开 19980/19981（main 产品与冒烟）及路线图 19982~19986。
 */
import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSpikeTools } from './tools.js'

const PORT = Number(process.env.SPIKE_PORT ?? 29980)

const mcpServer = new McpServer({ name: 'mcp-spike-http', version: '0.1.0' })
registerSpikeTools(mcpServer, 'http')
const transport = new StreamableHTTPTransport()

const app = new Hono()
app.all('/mcp', async (c) => {
  if (!mcpServer.isConnected()) await mcpServer.connect(transport)
  return transport.handleRequest(c)
})
app.get('/healthz', (c) => c.json({ app: 'mcp-spike-http', pid: process.pid }))

Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: app.fetch })
console.log(`[spike] http mcp on http://127.0.0.1:${PORT}/mcp (healthz: /healthz)`)
