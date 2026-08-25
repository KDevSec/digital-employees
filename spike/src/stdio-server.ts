/**
 * Q1a：stdio 形态 MCP server——mcp.json 的 command 形态（Bun 直跑 TS，无编译）。
 * stdout 专用于 MCP 协议流，任何日志一律 stderr（stdio transport 纪律）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerSpikeTools } from './tools.js'

const server = new McpServer({ name: 'mcp-spike-stdio', version: '0.1.0' })
registerSpikeTools(server, 'stdio')
await server.connect(new StdioServerTransport())
console.error('[spike] stdio mcp server ready')
