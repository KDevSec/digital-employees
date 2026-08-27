/**
 * Hono 适配器（S-12，设计 §1.2）——**全仓唯一 hono import 点**。
 * 把框架无关路由表挂到 Hono：每请求构造 Ctx（含 Host 头），
 * 先过 Host 白名单守卫，再分发给注册的 handler。
 * 响应用原生 Response 构造（Hono handler 兼容），绕开 ContentfulStatusCode 字面量约束。
 */
import { Hono } from 'hono'
import { forbiddenHostResponse, isLocalHost } from './guard'
import type { Ctx, Res, ResCookie, Route, RouteRegistry, SessionGuard } from './registry'

export function toHonoApp(
  registry: RouteRegistry & { routes: Route[] },
  opts?: { sessionGuard?: SessionGuard },
): Hono {
  // 装配保险丝（A-08）：有 auth 档路由却没注入 guard = main 装配漏接线，构造期显式炸（不等请求期放行事故）
  if (registry.routes.some((r) => r.auth !== undefined) && !opts?.sessionGuard) {
    throw new Error('存在 auth 档路由但未注入 sessionGuard——检查 main 装配（A-08）')
  }
  const app = new Hono()
  for (const route of registry.routes) {
    app.on(route.method, route.path, (c) => dispatch(c, route, opts?.sessionGuard))
  }
  return app
}

/** demo cookies() 迁移：Cookie 头 → 键值对（decodeURIComponent + 双段过滤） */
function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((value) => value.trim().split('=').map(decodeURIComponent))
      .filter((pair) => pair.length === 2),
  )
}

function serializeCookie(cookie: ResCookie): string {
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`]
  if (cookie.maxAgeSeconds !== undefined) parts.push(`Max-Age=${cookie.maxAgeSeconds}`)
  if (cookie.httpOnly) parts.push('HttpOnly')
  if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`)
  parts.push(`Path=${cookie.path ?? '/'}`)
  return parts.join('; ')
}

/** Res → Response（redirect/cookies/json/html/text 单点映射；guard 短路复用同一路径） */
export function resToResponse(res: Res): Response {
  const headers = new Headers()
  if (res.redirect !== undefined) headers.set('Location', res.redirect)
  for (const cookie of res.cookies ?? []) headers.append('Set-Cookie', serializeCookie(cookie))
  if (res.redirect !== undefined) {
    return new Response(null, { status: res.status, headers })
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
  c: { req: { path: string; header: (name: string) => string | undefined; json: () => Promise<unknown>; query: () => Record<string, string> } },
  route: Route,
  guard?: SessionGuard,
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
    cookies: parseCookies(c.req.header('Cookie')),
    query: c.req.query(),
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
