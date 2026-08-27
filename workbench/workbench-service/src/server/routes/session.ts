/**
 * session 域路由：GET /api/state + POST /api/logout。
 * D-049 桥接（2026-08-27）已退役：本域经 A 系列迁移升级为真实会话端点——
 * 开发环境语义沿用 schema.isDevEnvironment 同一判据（service.sessionGuard/state 内实现）；
 * 生产语义 /api/state 未登录从桥接期 401 升级为 200 + authenticated:false（裁决 D-am3）；
 * 开发态 installationId 从 'dev' 占位升级为真值（裁决 D-am4）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'

export interface SessionRouteDeps {
  service: {
    state: (ctx: Ctx) => Promise<Res>
    logout: (ctx: Ctx) => Promise<Res>
  }
}

export function registerSessionRoutes(reg: RouteRegistry, deps: SessionRouteDeps): void {
  reg.get('/api/state', (ctx) => deps.service.state(ctx))
  reg.post('/api/logout', (ctx) => deps.service.logout(ctx))
}
