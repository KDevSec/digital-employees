/**
 * 路由汇总表（I0-5 T1 分域注册，设计 D-1/D-2：静态 import 列表，一行一域）。
 * 不做 fs 扫描/动态 import 自动发现——bun --compile 单体里文件系统布局不存在；
 * 静态列表的合并冲突面 =「不同位置各插一行」，git 可自动合并（I1 并行线需求）。
 * I1 各线在此追加域：新建 routes/<domain>.ts 导出 register<Domain>Routes + 依赖窄化类型，
 * 并在 registerAllRoutes 里加一行（auth/employees/bases/kanban 等域文件由对应线自建，不预建空文件）。
 *
 * 注册产物 method+path 唯一性在此断言：两域注册同一路径时注册期即抛错——
 * HTTP 框架对重复路由不保证显式报错（可能静默先注册者胜出），保险丝不依赖框架行为。
 */
import type { Route, RouteRegistry } from '../registry'
import { registerInfraRoutes } from './infra'
import type { InfraRouteDeps } from './infra'
import { registerShellRoutes } from './shell'
import type { ShellRouteDeps } from './shell'
import { registerConfigRoutes } from './config'
import type { ConfigRouteDeps } from './config'
import { registerTemplatesRoutes } from './templates'
import type { TemplatesRouteDeps } from './templates'
import { registerEmployeesRoutes } from './employees'
import type { EmployeesRouteDeps } from './employees'
import { registerSkillsRoutes } from './skills'
import type { SkillsRouteDeps } from './skills'
import { registerSessionRoutes } from './session'
import type { SessionRouteDeps } from './session'
import { registerAuthRoutes } from './auth'
import type { AuthRouteDeps } from './auth'
import { registerEnrollmentRoutes } from './enrollment'
import type { EnrollmentRouteDeps } from './enrollment'
import { registerEngineRoutes } from './engine'
import type { EngineRouteDeps } from './engine'
import { registerInstallsRoutes } from './installs'
import type { InstallsRouteDeps } from './installs'
import { registerBasesRoutes } from './bases'
import type { BasesRouteDeps } from './bases'

/** 全量路由依赖 = 各域依赖之和（main 装配一次给全；域文件各取所需字段） */
export type RouteDeps = InfraRouteDeps & ShellRouteDeps & ConfigRouteDeps & TemplatesRouteDeps & EmployeesRouteDeps & SkillsRouteDeps & SessionRouteDeps & AuthRouteDeps & EnrollmentRouteDeps & EngineRouteDeps & InstallsRouteDeps & BasesRouteDeps

/** 汇总注册（静态表：一行一域；新增域在此追加一行） */
export function registerAllRoutes(reg: RouteRegistry & { routes: Route[] }, deps: RouteDeps): void {
  registerInfraRoutes(reg, deps)
  registerShellRoutes(reg, deps)
  registerConfigRoutes(reg, deps) // I0-5 T8 config 域（设计 D-14：GET/PUT /api/config/platform）
  registerTemplatesRoutes(reg, deps) // Task 7 B2 templates 域（GET /api/templates、GET /api/skills）
  registerEmployeesRoutes(reg, deps) // Task 11 B6 employees 域（POST /api/employees/generate、GET /api/employees/validate-id + GET /api/employees）
  registerSkillsRoutes(reg, deps) // Task 12 C1 skills 域（POST /api/skills/upload）
  registerSessionRoutes(reg, deps) // A 系列 session 域（GET /api/state + POST /api/logout；D-049 桥接退役）
  registerAuthRoutes(reg, deps) // A 系列 auth 域（GET /auth/login + GET /auth/callback，无档位）
  registerEnrollmentRoutes(reg, deps) // A 系列 enrollment 域（POST /api/enroll|progress|reset|heartbeat，全 session 档）
  registerEngineRoutes(reg, deps) // L3 T6 编排域（设计 §9.3：任务生命周期+引擎写面）
  registerInstallsRoutes(reg, deps) // I1 L2 安装线（设计 §10：deployments 列表/干跑/执行/漂移 + uninstall）
  registerBasesRoutes(reg, deps) // I1 L2 安装线（设计 §10：底座卡片/手动探测/模型清单）
  assertNoDuplicateRoutes(reg.routes)
}

/** method+path 唯一性保险丝（I1 并行线撞路由当场炸，不留给请求期静默遮蔽） */
function assertNoDuplicateRoutes(routes: readonly Route[]): void {
  const seen = new Set<string>()
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    if (seen.has(key)) {
      throw new Error(`路由重复注册：${key}——多域注册了同一 method+path，检查 routes/ 各域文件与 index.ts 汇总表`)
    }
    seen.add(key)
  }
}
