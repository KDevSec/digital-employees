/**
 * infra 域路由（I0-5 T1 分域注册，设计 D-3：服务本体自观察端点）。
 * 由原 endpoints.ts 拆分迁入：healthz 自检 / events SSE 骨架 / activity 活动任务计数，
 * handler 语义与响应形状逐字段不变（行为等价由既有契约测试佐证）。
 * 只面向框架无关 Ctx/Res（不 import hono——hono 只允许出现在 hono-adapter.ts 单点）。
 */
import { brand } from '../../brand'
import type { Ctx, Res, RouteRegistry } from '../registry'

/** infra 域依赖：healthz 契约字段的数据源（域文件只声明自己所需，不整包共用宽接口） */
export interface InfraRouteDeps {
  version: string
  pid: number
  uid: string
  /** profile 目录（healthz.dataDir 契约字段） */
  dataDir: string
  /** 进程启动毫秒时刻（healthz.uptime 由它现算） */
  uptime: () => number
}

/** GET /healthz —— C-4 契约：{app,status,version,pid,uid,uptime,dataDir}，uid 必含（a540c56）。 */
export function healthzHandler(deps: InfraRouteDeps) {
  return (_ctx: Ctx): Res => ({
    status: 200,
    json: {
      app: brand.app,
      status: 'ok',
      version: deps.version,
      pid: deps.pid,
      uid: deps.uid,
      uptime: deps.uptime(),
      dataDir: deps.dataDir,
    },
  })
}

/** GET /api/events —— SSE 骨架占位：连接即 204（设计 §10.3，V0.1 只保路径不破坏性变更）。 */
export function eventsHandler(_ctx: Ctx): Res {
  return { status: 204 }
}

/** GET /api/activity —— 优雅停服判据（TR-07 消费），V0.1 硬值 0（D-8 业务未落地）。 */
export function activityHandler(_ctx: Ctx): Res {
  return { status: 200, json: { conversationTasks: 0, triggerTasks: 0 } }
}

/** infra 域注册（只注册本域端点；汇总见 routes/index.ts）。 */
export function registerInfraRoutes(reg: RouteRegistry, deps: InfraRouteDeps): void {
  reg.get('/healthz', healthzHandler(deps))
  reg.get('/api/events', eventsHandler)
  reg.get('/api/activity', activityHandler)
}
