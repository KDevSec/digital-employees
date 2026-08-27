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
  /** 查询串解析（L3 T6 起 engine 域 events?after_seq= 消费；A 系列 /auth/callback 消费 code/state；缺省空——既有域不受影响） */
  query?: URLSearchParams
  /** 请求头小写键快照（L3 T7 起 SSE 消费 last-event-id；A 系列 /auth/callback 亦消费；缺省空——既有域不受影响） */
  headers?: Record<string, string>
  /** Cookie 解析（A 系列 A-02/A-07 会话读取）；adapter 单点解析 Cookie 头（demo cookies() 语义迁移） */
  cookies?: Record<string, string>
  /**
   * 原始请求体字节（content-type 非 application/json 的非 GET 请求时由 adapter 装载）。
   * L1 Task 12 / E-13：skills 域 multipart/form-data 上传走此通道；JSON 路径仍走 body 字段，行为不变。
   */
  bodyRaw?: ArrayBuffer
}

export interface Res {
  status: number
  json?: unknown
  text?: string
  /** HTML body（S-01 嵌入页）：adapter 以 text/html; charset=utf-8 透传 */
  html?: string
  /** 流式 body（L3 T7 SSE）：adapter 以 text/event-stream 透传（无缓存） */
  stream?: ReadableStream<Uint8Array>
  /** 3xx 重定向目标（A-02 登录链）：adapter 以 Location 头透传；与 json/html/text 互斥，redirect 胜出 */
  redirect?: string
  /** Set-Cookie 指令（A-02/A-07 建会话/清会话），adapter 逐条 append */
  cookies?: ResCookie[]
}

/** Set-Cookie 指令（A 系列登录链）：序列化顺序 Max-Age; HttpOnly; SameSite; Path，Path 缺省 / */
export interface ResCookie {
  name: string
  value: string
  /** 秒；缺省 = 会话 cookie；清除用 0 */
  maxAgeSeconds?: number
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax'
  path?: string
}

export type Handler = (ctx: Ctx) => Res | Promise<Res>

/** 鉴权档位（A-08，详设 §10.2）：业务模块只声明档位，实现由 app/platform-access 提供、main 注入 */
export type AuthGrade = 'session' | 'session-active'

/** 框架无关会话守卫：null = 放行；Res = 短路返回（401/403） */
export type SessionGuard = (ctx: Ctx, grade: AuthGrade) => Promise<Res | null>

export interface RouteOptions {
  auth?: AuthGrade
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  handler: Handler
  /** 鉴权档位（A-08）：adapter dispatch 在 Host 守卫之后、handler 之前执行 sessionGuard */
  auth?: AuthGrade
}

export interface RouteRegistry {
  get(path: string, handler: Handler, opts?: RouteOptions): void
  post(path: string, handler: Handler, opts?: RouteOptions): void
  /** I0-5 T8 增：PUT（config 域 /api/config/platform——设计 D-14） */
  put(path: string, handler: Handler, opts?: RouteOptions): void
}

/** 路由只经 get/post/put 声明（未声明方法在类型层即不可注册）。 */
export function createRegistry(): RouteRegistry & { routes: Route[] } {
  const routes: Route[] = []
  return {
    routes,
    get(path, handler, opts) {
      routes.push({ method: 'GET', path, handler, auth: opts?.auth })
    },
    post(path, handler, opts) {
      routes.push({ method: 'POST', path, handler, auth: opts?.auth })
    },
    put(path, handler, opts) {
      routes.push({ method: 'PUT', path, handler, auth: opts?.auth })
    },
  }
}
