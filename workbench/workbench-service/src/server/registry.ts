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
  /** 查询串解析（T6 起 engine 域 events?after_seq= 消费；缺省空——既有域不受影响） */
  query?: URLSearchParams
  /** 请求头小写键快照（T7 起 SSE 消费 last-event-id；缺省空——既有域不受影响） */
  headers?: Record<string, string>
}

export interface Res {
  status: number
  json?: unknown
  text?: string
  /** HTML body（S-01 嵌入页）：adapter 以 text/html; charset=utf-8 透传 */
  html?: string
  /** 流式 body（L3 T7 SSE）：adapter 以 text/event-stream 透传（无缓存） */
  stream?: ReadableStream<Uint8Array>
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
