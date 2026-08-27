/**
 * Hono 适配器（S-12，设计 §1.2）——**全仓唯一 hono import 点**。
 * 把框架无关路由表挂到 Hono：每请求构造 Ctx（含 Host 头），
 * 先过 Host 白名单守卫，再分发给注册的 handler。
 * 响应用原生 Response 构造（Hono handler 兼容），绕开 ContentfulStatusCode 字面量约束。
 */
import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { forbiddenHostResponse, isLocalHost } from './guard'
import type { Ctx, Res, ResCookie, Route, RouteRegistry, SessionGuard } from './registry'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** toHonoApp 装配选项（并集）：
 *  - mcpServer：MCP 例外口（L3 T8，受控）——/mcp 需要 Web 标准 Request/Response 流，
 *    经 @hono/mcp StreamableHTTPTransport.handleRequest(c) 直挂——唯一越过 registry
 *    「业务路由框架无关」纪律的位置，例外收敛在本文件单点（MCP server 构建在 server/mcp/engine-mcp.ts）。
 *  - sessionGuard：会话守卫（A 系列 A-08 鉴权档位）——档位路由（RouteOptions.auth）的
 *    401/403 执行点，实现由 app/platform-access 提供、main 装配注入。 */
export interface ToHonoAppOptions {
  mcpServer?: McpServer
  sessionGuard?: SessionGuard
}

export function toHonoApp(
  registry: RouteRegistry & { routes: Route[] },
  opts?: ToHonoAppOptions,
): Hono {
  // 装配保险丝（A-08）：有 auth 档路由却没注入 guard = main 装配漏接线，构造期显式炸（不等请求期放行事故）
  if (registry.routes.some((r) => r.auth !== undefined) && !opts?.sessionGuard) {
    throw new Error('存在 auth 档路由但未注入 sessionGuard——检查 main 装配（A-08）')
  }
  const app = new Hono()
  if (opts?.mcpServer) {
    const transport = new StreamableHTTPTransport()
    app.all('/mcp', async (c) => {
      if (!opts.mcpServer!.isConnected()) await opts.mcpServer!.connect(transport)
      return transport.handleRequest(c)
    })
  }
  for (const route of registry.routes) {
    app.on(route.method, route.path, (c) => dispatch(c, route, opts?.sessionGuard))
  }
  return app
}

/** 查询串解析（L3 T6 起 engine 域 events?after_seq= 消费）：从完整 url 解析，失败归一空集 */
function parseQuery(url: string): URLSearchParams {
  const qIndex = url.indexOf('?')
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '')
}

/** demo cookies() 迁移：Cookie 头 → 键值对（decodeURIComponent + 双段过滤）。
 *  容错（fix round 1 裁决）：畸形对（裸 % 解码失败）整对跳过——调用点先于 Host 守卫，
 *  不容一个坏 cookie 把任意路由炸成 500；畸形会话 cookie → undefined → 匿名语义，正确。 */
function parseCookies(header: string | undefined): Record<string, string> {
  const pairs: [string, string][] = []
  for (const raw of (header ?? '').split(';')) {
    const segments = raw.trim().split('=')
    if (segments.length !== 2) continue
    try {
      pairs.push([decodeURIComponent(segments[0]), decodeURIComponent(segments[1])])
    } catch {
      // 畸形百分号编码：跳过该对，不拖垮同头其余 cookie
    }
  }
  return Object.fromEntries(pairs)
}

function serializeCookie(cookie: ResCookie): string {
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`]
  if (cookie.maxAgeSeconds !== undefined) parts.push(`Max-Age=${cookie.maxAgeSeconds}`)
  if (cookie.httpOnly) parts.push('HttpOnly')
  if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`)
  parts.push(`Path=${cookie.path ?? '/'}`)
  return parts.join('; ')
}

/** Res → Response（redirect/cookies/stream/json/html/text 单点映射；guard 短路复用同一路径） */
export function resToResponse(res: Res): Response {
  const headers = new Headers()
  if (res.redirect !== undefined) headers.set('Location', res.redirect)
  for (const cookie of res.cookies ?? []) headers.append('Set-Cookie', serializeCookie(cookie))
  if (res.redirect !== undefined) {
    return new Response(null, { status: res.status, headers })
  }
  if (res.stream !== undefined) {
    return new Response(res.stream, {
      status: res.status,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (res.json !== undefined) {
    return Response.json(res.json, { status: res.status, headers })
  }
  if (res.html !== undefined) {
    headers.set('content-type', 'text/html; charset=utf-8')
    return new Response(res.html, { status: res.status, headers })
  }
  // 204/205/304 不得携带 body（Fetch 规范），无 text 时传 null 才能构造合法 Response
  return new Response(res.text ?? null, { status: res.status, headers })
}

async function dispatch(
  c: { req: { path: string; url: string; header: (name: string) => string | undefined; json: () => Promise<unknown>; raw: { headers: Headers; arrayBuffer(): Promise<ArrayBuffer> } } },
  route: Route,
  guard?: SessionGuard,
): Promise<Response> {
  // 无 Host 头的请求（Hono 测试助手 app.request、极简客户端）按直连回环放行：
  // DNS rebinding 攻击必然携带恶意 Host，白名单判据仍是「带 Host 则必须白名单内」。
  const ctx: Ctx = {
    method: route.method,
    path: c.req.path,
    host: c.req.header('Host') ?? '127.0.0.1',
    // 请求体三态（Task 12 / E-13 融合）：GET 不读（SSE 长连接安全）；
    // 非 GET 且 content-type 为 JSON → json().catch(undefined)（非 JSON/空 body 归一 undefined，交由各域 schema 校验 400）；
    // 非 GET 且非 JSON（multipart 等）→ bodyRaw 装载原始字节（skills 域 zip 上传走此通道）。
    ...(route.method === 'GET'
      ? {}
      : (c.req.header('content-type') ?? '').toLowerCase().includes('application/json')
        ? { body: await c.req.json().catch(() => undefined) }
        : { bodyRaw: await c.req.raw.arrayBuffer().catch(() => undefined) }),
    // 查询串仅 GET 消费（L3 T6 engine 域 after_seq 过滤；A 系列 /auth/callback 同为 GET）
    query: route.method === 'GET' ? parseQuery(c.req.url) : undefined,
    // 请求头小写键快照（L3 T7 SSE last-event-id）；adapter 单点提取，域文件不碰框架类型
    headers: Object.fromEntries(c.req.raw.headers),
    // Cookie 解析（A 系列 A-02/A-07 会话读取）；全部方法可读（POST /api/logout 消费）
    cookies: parseCookies(c.req.header('Cookie')),
  }
  if (!isLocalHost(ctx.host)) {
    const denied = forbiddenHostResponse(ctx.host)
    return new Response(denied.text, { status: denied.status })
  }
  // 鉴权档位（A-08，设计 §4.2）：Host 守卫之后、handler 之前；guard 返回 Res 即短路（401/403 走同一条映射路径）
  if (route.auth !== undefined && guard !== undefined) {
    const denied = await guard(ctx, route.auth)
    if (denied !== null) return resToResponse(denied)
  }
  const res = await route.handler(ctx)
  return resToResponse(res)
}
