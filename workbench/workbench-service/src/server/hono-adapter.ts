/**
 * Hono 适配器（S-12，设计 §1.2）——**全仓唯一 hono import 点**。
 * 把框架无关路由表挂到 Hono：每请求构造 Ctx（含 Host 头），
 * 先过 Host 白名单守卫，再分发给注册的 handler。
 * 响应用原生 Response 构造（Hono handler 兼容），绕开 ContentfulStatusCode 字面量约束。
 */
import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { forbiddenHostResponse, isLocalHost } from './guard'
import type { Ctx, Route, RouteRegistry } from './registry'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** MCP 例外口（L3 T8，受控）：/mcp 需要 Web 标准 Request/Response 流，经 @hono/mcp
 *  StreamableHTTPTransport.handleRequest(c) 直挂——唯一越过 registry「业务路由框架无关」纪律的位置，
 *  例外收敛在本文件单点（routes/ 各域纪律不变；MCP server 构建在 server/mcp/engine-mcp.ts）。 */
export interface McpMountOptions {
  mcpServer: McpServer
}

export function toHonoApp(
  registry: RouteRegistry & { routes: Route[] },
  mcp?: McpMountOptions,
): Hono {
  const app = new Hono()
  if (mcp) {
    const transport = new StreamableHTTPTransport()
    app.all('/mcp', async (c) => {
      if (!mcp.mcpServer.isConnected()) await mcp.mcpServer.connect(transport)
      return transport.handleRequest(c)
    })
  }
  for (const route of registry.routes) {
    app.on(route.method, route.path, (c) => dispatch(c, route))
  }
  return app
}

function parseQuery(url: string): URLSearchParams {
  const qIndex = url.indexOf('?')
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
}

async function dispatch(
  c: { req: { path: string; url: string; header: (name: string) => string | undefined; json: () => Promise<unknown>; raw: { headers: Headers } } },
  route: Route,
): Promise<Response> {
  // 无 Host 头的请求（Hono 测试助手 app.request、极简客户端）按直连回环放行：
  // DNS rebinding 攻击必然携带恶意 Host，白名单判据仍是「带 Host 则必须白名单内」。
  const ctx: Ctx = {
    method: route.method,
    path: c.req.path,
    host: c.req.header('Host') ?? '127.0.0.1',
    // 请求体（I0-5 T8 起 config 域 PUT 消费）：非 GET 才读，GET 不触碰 body（SSE 等长连接安全）。
    // 非 JSON / 空 body 解析失败归一 undefined，交由各域 schema 校验给出 400（adapter 不猜语义）。
    body: route.method === 'GET' ? undefined : await c.req.json().catch(() => undefined),
    // 查询串仅 GET 消费（T6 engine 域 after_seq 过滤）；从完整 url 解析，失败归一空集
    query: route.method === 'GET' ? parseQuery(c.req.url) : undefined,
    // 请求头小写键快照（T7 SSE last-event-id）；adapter 单点提取，域文件不碰框架类型
    headers: Object.fromEntries(c.req.raw.headers),
  }
  if (!isLocalHost(ctx.host)) {
    const denied = forbiddenHostResponse(ctx.host)
    return new Response(denied.text, { status: denied.status })
  }
  const res = await route.handler(ctx)
  if (res.json !== undefined) {
    return Response.json(res.json, { status: res.status })
  }
  if (res.stream !== undefined) {
    return new Response(res.stream, {
      status: res.status,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (res.html !== undefined) {
    return new Response(res.html, {
      status: res.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
  // 204/205/304 不得携带 body（Fetch 规范），无 text 时传 null 才能构造合法 Response
  return new Response(res.text ?? null, { status: res.status })
}
