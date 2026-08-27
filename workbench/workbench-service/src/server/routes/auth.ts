/**
 * auth 域路由（A-02）：GET /auth/login + GET /auth/callback。
 * 薄壳注册（设计 §3）：handler 逻辑在 app/platform-access/service.ts（deps 注入切片）。
 * 档位：无——auth 端点本身不设防（A-08 边界约定，S-12 Host 守卫仍先行）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'

export interface AuthRouteDeps {
  service: {
    login: (ctx: Ctx) => Promise<Res>
    callback: (ctx: Ctx) => Promise<Res>
  }
}

export function registerAuthRoutes(reg: RouteRegistry, deps: AuthRouteDeps): void {
  reg.get('/auth/login', (ctx) => deps.service.login(ctx))
  reg.get('/auth/callback', (ctx) => deps.service.callback(ctx))
}
