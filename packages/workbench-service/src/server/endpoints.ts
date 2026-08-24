/**
 * V0.1 端点集（设计 §10.2 端点总表的服务侧骨架行）。
 * 只面向框架无关 Ctx/Res（不 import hono）；依赖全部注入便于测试。
 */
import { brand } from '../brand'
import type { Ctx, Res, RouteRegistry } from './registry'

export interface EndpointDeps {
  version: string
  pid: number
  uid: string
  /** profile 目录（healthz.dataDir 契约字段） */
  dataDir: string
  /** 进程启动毫秒时刻（healthz.uptime 由它现算） */
  uptime: () => number
  /** 嵌入的 Web 壳单文件页（S-01/D-6：main 组装以 text import 注入，测试注入真实产物） */
  indexHtml: string
}

/** GET /healthz —— C-4 契约：{app,status,version,pid,uid,uptime,dataDir}，uid 必含（a540c56）。 */
export function healthzHandler(deps: EndpointDeps) {
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

/** GET / —— 嵌入的 Web 壳单文件页（S-01：路径取 brand.homepagePath 单源）。 */
export function rootHandler(deps: EndpointDeps) {
  return (_ctx: Ctx): Res => ({ status: 200, html: deps.indexHtml })
}

export function registerEndpoints(reg: RouteRegistry, deps: EndpointDeps): void {
  reg.get(brand.homepagePath, rootHandler(deps))
  reg.get('/healthz', healthzHandler(deps))
  reg.get('/api/events', eventsHandler)
  reg.get('/api/activity', activityHandler)
}
