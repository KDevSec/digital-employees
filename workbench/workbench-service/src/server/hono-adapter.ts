/**
 * Hono 适配器（S-12，设计 §1.2）——**全仓唯一 hono import 点**。
 * 把框架无关路由表挂到 Hono：每请求构造 Ctx（含 Host 头），
 * 先过 Host 白名单守卫，再分发给注册的 handler。
 * 响应用原生 Response 构造（Hono handler 兼容），绕开 ContentfulStatusCode 字面量约束。
 */
import { Hono } from 'hono'
import { forbiddenHostResponse, isLocalHost } from './guard'
import type { Ctx, Route, RouteRegistry } from './registry'

export function toHonoApp(
  registry: RouteRegistry & { routes: Route[] },
): Hono {
  const app = new Hono()
  for (const route of registry.routes) {
    app.on(route.method, route.path, (c) => dispatch(c, route))
  }
  return app
}

async function dispatch(
  c: { req: { path: string; header: (name: string) => string | undefined; json: () => Promise<unknown>; query: (key: string) => string | undefined; queries: () => Record<string, string[]> } },
  route: Route,
): Promise<Response> {
  // 无 Host 头的请求（Hono 测试助手 app.request、极简客户端）按直连回环放行：
  // DNS rebinding 攻击必然携带恶意 Host，白名单判据仍是「带 Host 则必须白名单内」。
  // 查询参数：c.req.queries() 返回 Record<string, string[]>；扁平为首值映射供 handler 用（无 query 时空对象）
  const queries = c.req.queries()
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(queries)) {
    if (Array.isArray(v) && v.length > 0) {
      query[k] = v[0]!
    }
  }
  const ctx: Ctx = {
    method: route.method,
    path: c.req.path,
    host: c.req.header('Host') ?? '127.0.0.1',
    // 请求体（I0-5 T8 起 config 域 PUT 消费）：非 GET 才读，GET 不触碰 body（SSE 等长连接安全）。
    // 非 JSON / 空 body 解析失败归一 undefined，交由各域 schema 校验给出 400（adapter 不猜语义）。
    body: route.method === 'GET' ? undefined : await c.req.json().catch(() => undefined),
    query,
  }
  if (!isLocalHost(ctx.host)) {
    const denied = forbiddenHostResponse(ctx.host)
    return new Response(denied.text, { status: denied.status })
  }
  const res = await route.handler(ctx)
  if (res.json !== undefined) {
    return Response.json(res.json, { status: res.status })
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
