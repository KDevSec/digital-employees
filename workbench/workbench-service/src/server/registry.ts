/**
 * 框架无关路由表（S-12，设计 §1.2）。
 * 本文件【禁止 import hono】——HTTP 框架只允许出现在 hono-adapter.ts 单点。
 * 业务端点（routes/ 目录各域文件）与守卫（guard.ts）只面向本模块的 Ctx/Res 形状。
 */

export interface Ctx {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  host: string
  body?: unknown
  /** Cookie 头解析产物（demo cookies() 语义迁移，adapter 单点映射，设计 §4.1） */
  cookies?: Record<string, string>
  /** 查询串解析产物（/auth/callback 消费 code/state，adapter 单点映射，设计 §4.1） */
  query?: Record<string, string>
}

/** Set-Cookie 指令（A-02 登录链专用语义，adapter 单点映射，设计 §4.1） */
export interface ResCookie {
  name: string
  value: string
  maxAgeSeconds?: number
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax'
  path?: string
}

export interface Res {
  status: number
  json?: unknown
  text?: string
  /** HTML body（S-01 嵌入页）：adapter 以 text/html; charset=utf-8 透传 */
  html?: string
  /** 3xx Location（A-02 登录链专用语义，adapter 单点映射，设计 §4.1）；与 json/html/text 互斥，redirect 胜出 */
  redirect?: string
  /** Set-Cookie 批量下发（A-02 登录链专用语义，adapter 单点映射，设计 §4.1） */
  cookies?: ResCookie[]
}

export type Handler = (ctx: Ctx) => Res | Promise<Res>

export interface Route {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  handler: Handler
}

export interface RouteRegistry {
  get(path: string, handler: Handler): void
  post(path: string, handler: Handler): void
  /** I0-5 T8 增：PUT（config 域 /api/config/platform——设计 D-14） */
  put(path: string, handler: Handler): void
}

/** 路由只经 get/post/put 声明（未声明方法在类型层即不可注册）。 */
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
    put(path, handler) {
      routes.push({ method: 'PUT', path, handler })
    },
  }
}
