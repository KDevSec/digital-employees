/**
 * shell 域路由（I0-5 T1 分域注册，设计 D-3：Web 壳入口）。
 * 由原 endpoints.ts 拆分迁入：GET / 嵌入页行为不变（S-01）。
 * I1 各业务线新增域 = 新建 routes/<domain>.ts + index.ts 汇总表加一行（设计 D-1）。
 */
import { brand } from '../../brand'
import type { Ctx, Res, RouteRegistry } from '../registry'

/** shell 域依赖（域文件只声明自己所需，不整包共用宽接口） */
export interface ShellRouteDeps {
  /** 嵌入的 Web 壳单文件页（S-01/D-6：main 组装以 text import 注入，测试注入真实产物） */
  indexHtml: string
}

/** GET / —— 嵌入的 Web 壳单文件页（S-01：路径取 brand.homepagePath 单源）。 */
export function rootHandler(deps: ShellRouteDeps) {
  return (_ctx: Ctx): Res => ({ status: 200, html: deps.indexHtml })
}

/** shell 域注册（只注册本域端点；汇总见 routes/index.ts）。 */
export function registerShellRoutes(reg: RouteRegistry, deps: ShellRouteDeps): void {
  reg.get(brand.homepagePath, rootHandler(deps))
}
