/**
 * templates 域路由（Task 7 / B2，设计：GET /api/templates、GET /api/skills）。
 * - GET /api/templates → 200 + { items: TemplateMeta[] }（builtin 先、custom 后；坏 manifest 缺席）
 * - GET /api/skills → 200 + { items: SkillMeta[] }（跨模板聚合 + 按 name 首见去重）
 * 域文件按 routes/config.ts 模式：registerTemplatesRoutes(reg, deps) + TemplatesRouteDeps 窄接口。
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz / config 同档「无鉴权」；本机边界 = S-12
 * 仅绑 127.0.0.1 + Host 白名单守卫（adapter 层先于 handler 拦截）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'
import type { TemplatesProvider } from '../../templates/provider'

/** templates 域依赖：provider（builtin 内存 + custom fs 聚合） */
export interface TemplatesRouteDeps {
  templates: TemplatesProvider
}

/** GET /api/templates —— 模板清单（builtin 先、custom 后；坏 manifest 缺席不炸） */
export function templatesListHandler(deps: TemplatesRouteDeps) {
  return (_ctx: Ctx): Res => ({
    status: 200,
    json: { items: deps.templates.list() },
  })
}

/** GET /api/skills —— skill 全集（跨模板聚合 + 按 name 首见去重） */
export function skillsListHandler(deps: TemplatesRouteDeps) {
  return (_ctx: Ctx): Res => ({
    status: 200,
    json: { items: deps.templates.listSkills() },
  })
}

/** templates 域注册（只注册本域端点；汇总见 routes/index.ts） */
export function registerTemplatesRoutes(reg: RouteRegistry, deps: TemplatesRouteDeps): void {
  reg.get('/api/templates', templatesListHandler(deps))
  reg.get('/api/skills', skillsListHandler(deps))
}
