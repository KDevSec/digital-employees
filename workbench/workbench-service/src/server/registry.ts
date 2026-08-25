/**
 * 框架无关路由表（S-12，设计 §1.2）。
 * 本文件【禁止 import hono】——HTTP 框架只允许出现在 hono-adapter.ts 单点。
 * 业务端点（endpoints.ts）与守卫（guard.ts）只面向本模块的 Ctx/Res 形状。
 */

export interface Ctx {
  method: 'GET' | 'POST'
  path: string
  host: string
  body?: unknown
}

export interface Res {
  status: number
  json?: unknown
  text?: string
  /** HTML body（S-01 嵌入页）：adapter 以 text/html; charset=utf-8 透传 */
  html?: string
}

export type Handler = (ctx: Ctx) => Res | Promise<Res>

export interface Route {
  method: 'GET' | 'POST'
  path: string
  handler: Handler
}

export interface RouteRegistry {
  get(path: string, handler: Handler): void
  post(path: string, handler: Handler): void
}

/** 路由只经 get/post 声明（未声明方法在类型层即不可注册）。 */
export function createRegistry(): RouteRegistry & { routes: Route[] } {
  const routes: Route[] = []
  return {
    routes,
    get(path, handler) {
      routes.push({ method: 'GET', path, handler })
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler })
    },
  }
}
