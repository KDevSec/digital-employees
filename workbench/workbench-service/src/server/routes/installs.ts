/**
 * installs 域路由（设计 §10；I0-5 分域注册）。
 * - 错误形状 { error: { code, message } }（沿 config 域同款——web 侧 api/access.ts 免适配）；
 *   鉴权档与 config 域一致（暂无会话机制 G-1，仅本机边界 + Host 白名单守卫，落地后升档）。
 * - launch 不设 HTTP 面（设计 §10：进程内库接口，L3 spawn runner 直接消费，D-048）。
 * - plan 端点 = 干跑：parsePackage → negotiate → adapter.plan 纯函数直接组装，
 *   不调 installEmployee——零落盘副作用（不建 home、不写 registry/报告）。
 * - GET /api/deployments 的 ?employee_id= / ?base= 过滤：Ctx 尚无 query 面（S-12 框架无关
 *   形状），V0.1 返回全量列表，查询参数随 Ctx 扩展补做（设计 §10 表格项的分期落地）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { BaseAdapter, BaseId } from '../../adapters/contract'
import { baseProfiles } from '../../adapters/index'
import { createClaudeCodeAdapter } from '../../adapters/claude-code/index'
import { createCodebuddyAdapter } from '../../adapters/codebuddy/index'
import { createQoderAdapter } from '../../adapters/qoder/index'
import { verifyManifest, manifestPath, type InstallManifest } from '../../installs/manifest'
import { negotiate } from '../../installs/negotiate'
import { createDeploymentRegistry } from '../../installs/registry/registry'
import { installEmployee, type InstallServiceDeps } from '../../installs/service'
import { parsePackage } from '../../installs/spec/parser'
import { uninstallEmployee } from '../../installs/uninstall/uninstall'
import type { Ctx, Res, RouteRegistry } from '../registry'

const baseIdSchema = z.enum(['claude-code', 'codebuddy', 'qoder'])
const executeSchema = z.object({ employee_id: z.string().min(1), base: baseIdSchema }).strict()
const uninstallSchema = z.object({ employee_id: z.string().min(1), base: baseIdSchema, force: z.boolean().optional() }).strict()

/** 干跑/执行共用的 adapter 工厂表（service.ts 同款——其私有不外泄，此处自持一份） */
const ADAPTERS: Record<BaseId, () => BaseAdapter> = {
  'claude-code': createClaudeCodeAdapter,
  codebuddy: createCodebuddyAdapter,
  qoder: createQoderAdapter,
}

export interface InstallsRouteDeps extends InstallServiceDeps {
  /** 员工 id → 包根目录（E 系列 employees/ 目录接管前的装配口径） */
  packageRoots: Record<string, string>
}

function err(status: number, code: string, message: string): Res {
  return { status, json: { error: { code, message } } }
}

export function registerInstallsRoutes(reg: RouteRegistry, deps: InstallsRouteDeps): void {
  reg.get('/api/deployments', () => {
    const registry = createDeploymentRegistry(deps.registryFile)
    return { status: 200, json: registry.list() }
  })

  reg.post('/api/deployments/plan', async (ctx: Ctx): Promise<Res> => {
    const parsed = executeSchema.safeParse(ctx.body)
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    const root = deps.packageRoots[parsed.data.employee_id]
    if (!root) return err(404, 'EMPLOYEE_NOT_FOUND', `员工不存在：${parsed.data.employee_id}`)
    // 干跑：negotiate + plan 纯函数组装（零副作用——设计 §10「预览/冲突决议收集」的 V0.1 形态）
    const spec = await parsePackage(root)
    const base = parsed.data.base
    const home = join(deps.staffRoot, base, spec.id)
    const negotiation = negotiate(spec, baseProfiles[base], deps.probe(base))
    const placements = ADAPTERS[base]().plan(spec, { home }).placements
    return { status: 200, json: { negotiation, placements } }
  })

  reg.post('/api/deployments/execute', async (ctx: Ctx): Promise<Res> => {
    const parsed = executeSchema.safeParse(ctx.body)
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    const root = deps.packageRoots[parsed.data.employee_id]
    if (!root) return err(404, 'EMPLOYEE_NOT_FOUND', `员工不存在：${parsed.data.employee_id}`)
    const spec = await parsePackage(root)
    const report = installEmployee(deps, { spec, packageRoot: root, base: parsed.data.base })
    return { status: 200, json: report }
  })

  reg.post('/api/deployments/verify', async (ctx: Ctx): Promise<Res> => {
    const parsed = executeSchema.safeParse(ctx.body)
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    const rec = createDeploymentRegistry(deps.registryFile).find(parsed.data.base, parsed.data.employee_id)
    if (!rec) return err(404, 'DEPLOYMENT_NOT_FOUND', '未安装')
    const manifest = existsSync(manifestPath(rec.home))
      ? JSON.parse(readFileSync(manifestPath(rec.home), 'utf8')) as InstallManifest
      : null
    // manifest 本体缺失 = 最严重漂移（域可能半途被删）；本端点只读检测，修复 = 重跑 execute 幂等自愈
    const drift = manifest
      ? verifyManifest(rec.home, manifest)
      : [{ path: '.devzero-manifest.json', kind: 'missing' as const }]
    return { status: 200, json: { drift } }
  })

  reg.post('/api/uninstall', async (ctx: Ctx): Promise<Res> => {
    const parsed = uninstallSchema.safeParse(ctx.body)
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    // HTTP 面 snake_case（employee_id，设计 §10）→ 服务面 camelCase（employeeId，Task 10 签名）
    const r = uninstallEmployee(deps, {
      employeeId: parsed.data.employee_id,
      base: parsed.data.base,
      force: parsed.data.force,
    })
    if (r === null) return err(404, 'DEPLOYMENT_NOT_FOUND', '未安装（幂等 no-op）')
    return { status: 200, json: r }
  })
}
