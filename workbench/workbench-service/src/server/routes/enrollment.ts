/**
 * enrollment 域路由（A-03/A-04/A-05）：POST /api/enroll + /api/progress + /api/reset + /api/heartbeat。
 * 四端点全 session 档（heartbeat 按详设 §10.2 升档——偏差 #4；demo 无鉴权已裁决修正）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'

export interface EnrollmentRouteDeps {
  service: {
    enroll: (ctx: Ctx) => Promise<Res>
    progress: (ctx: Ctx) => Promise<Res>
    heartbeat: (ctx: Ctx) => Promise<Res>
    reset: (ctx: Ctx) => Promise<Res>
  }
}

export function registerEnrollmentRoutes(reg: RouteRegistry, deps: EnrollmentRouteDeps): void {
  reg.post('/api/enroll', (ctx) => deps.service.enroll(ctx), { auth: 'session' })
  reg.post('/api/progress', (ctx) => deps.service.progress(ctx), { auth: 'session' })
  reg.post('/api/reset', (ctx) => deps.service.reset(ctx), { auth: 'session' })
  reg.post('/api/heartbeat', (ctx) => deps.service.heartbeat(ctx), { auth: 'session' })
}
