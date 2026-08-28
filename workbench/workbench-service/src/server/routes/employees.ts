/**
 * employees 域路由（Task 11 / B6，设计：POST /api/employees/generate、GET /api/employees/validate-id）。
 * - POST /api/employees/generate（body `{draft}` → 200 GenerateResult）
 *   错误形状：
 *     422 VALIDATION_FAILED —— DraftValidationError，field_errors 含 step（FIELD_STEP_MAP 映射 path 前段）
 *     422 SKILL_MISSING —— SkillMissingError
 *     409 ID_CONFLICT —— EmployeeIdConflictError
 *     400 —— body 缺 draft
 * - GET /api/employees/validate-id?id= → { available, suggestion? }（不可用时 suggestion = `<id>-2` 起递增）
 *
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz / config / templates 同档「无鉴权」；本机边界 = S-12
 * 仅绑 127.0.0.1 + Host 白名单守卫（adapter 层先于 handler 拦截）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'
import type {
  EmployeeDraft,
  GenerateResult,
} from '../../employees/builder'
import {
  DraftValidationError,
  SkillMissingError,
} from '../../employees/builder'
import { EmployeeIdConflictError } from '../../employees/store'

/** employees 域依赖：builder（管线八步）+ store（id 冲突预检/suggestion + 花名册扫描派生） */
export interface EmployeesRouteDeps {
  builder: {
    generate(draft: EmployeeDraft): Promise<GenerateResult>
  }
  store: {
    /** id 冲突预检（generate 路径用） */
    exists(id: string): boolean
    /** 花名册扫描：返回 [{id, manifest}]，manifest 是 unknown（yaml load 原样，不过 schema） */
    list(): Array<{ id: string; manifest: unknown }>
    /** 最近一次 list() 收集的坏 yaml 目录 id 列表 */
    readonly invalid: string[]
  }
}

/**
 * 路径前段 → step 映射（与 422 field_errors.step 字段对齐；缺省 'base'）。
 *
 * brief「path 前段 agent/org/operator/display/id 等 → 'agent'」中"等"涵盖全部元数据字段
 * （brief/avatar/version/upp_version/kind/requires 同属向导 agent 配置步骤）。
 * 命名空间划分与向导表单步骤对齐：agent（身份/元数据）→ skills → hooks-tools → connectors → base（管理面/其他）。
 */
export const FIELD_STEP_MAP: Record<string, string> = {
  agent: 'agent',
  id: 'agent',
  display: 'agent',
  brief: 'agent',
  avatar: 'agent',
  version: 'agent',
  upp_version: 'agent',
  kind: 'agent',
  org: 'agent',
  operator: 'agent',
  requires: 'agent',
  skills: 'skills',
  hooks: 'hooks-tools',
  tools: 'hooks-tools',
  connectors: 'connectors',
}

/** path → step（path 前段映射；未命中 'base'） */
function fieldStep(path: string): string {
  const first = path.split('.')[0] ?? ''
  return FIELD_STEP_MAP[first] ?? 'base'
}

/** 错误码（沿 VALIDATION_FAILED / ID_CONFLICT / SKILL_MISSING 命名风格） */
const VALIDATION_FAILED = 'VALIDATION_FAILED'
const ID_CONFLICT = 'ID_CONFLICT'
const SKILL_MISSING = 'SKILL_MISSING'

/** POST /api/employees/generate —— 八步管线落盘；错误按上面定义映射 HTTP 状态。 */
export function employeesGenerateHandler(deps: EmployeesRouteDeps) {
  return async (ctx: Ctx): Promise<Res> => {
    const body = ctx.body as { draft?: EmployeeDraft } | undefined
    if (!body || typeof body !== 'object' || body.draft === undefined) {
      return { status: 400, json: { code: 'BAD_REQUEST', message: 'body 缺 draft 字段' } }
    }
    const draft = body.draft
    try {
      const result = await deps.builder.generate(draft)
      return { status: 200, json: result }
    } catch (err) {
      if (err instanceof DraftValidationError) {
        return {
          status: 422,
          json: {
            code: VALIDATION_FAILED,
            field_errors: err.issues.map((i) => ({
              step: fieldStep(i.path),
              field: i.path,
              message: i.message,
            })),
          },
        }
      }
      if (err instanceof EmployeeIdConflictError) {
        return {
          status: 409,
          json: { code: ID_CONFLICT, message: err.message },
        }
      }
      if (err instanceof SkillMissingError) {
        return {
          status: 422,
          json: { code: SKILL_MISSING, message: err.message },
        }
      }
      // 未分类错误 —— 不暴露内部细节，500 兜底
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 500, json: { code: 'INTERNAL_ERROR', message: msg } }
    }
  }
}

/** GET /api/employees/validate-id —— id 可用性 + 建议（不可用时 suggestion = `<id>-2` 起递增） */
export function employeesValidateIdHandler(deps: EmployeesRouteDeps) {
  return (ctx: Ctx): Res => {
    const id = ctx.query?.get('id') ?? undefined
    if (!id) {
      return { status: 400, json: { code: 'BAD_REQUEST', message: 'query 缺 id 参数' } }
    }
    if (deps.store.exists(id)) {
      // 找下一个可用 suggestion：`<id>-2`、`<id>-3` ... 首个不存在即返回
      let n = 2
      while (deps.store.exists(`${id}-${n}`)) {
        n++
      }
      return { status: 200, json: { available: false, suggestion: `${id}-${n}` } }
    }
    return { status: 200, json: { available: true } }
  }
}

/**
 * 花名册卡片字段（GET /api/employees 派生；仅展示所需字段子集，无安装数据——E-10 后续批）。
 * 字段全部 string（id/display/brief/avatar/version）+ kind 枚举；防御性提取后兜底空串。
 */
export interface EmployeeCard {
  id: string
  display: string
  brief: string
  avatar: string
  kind: string
  version: string
}

/**
 * 从 manifest（unknown，store.list 返回的 yaml load 原样）防御性提取卡片字段。
 * - manifest 非对象 → 全兜底空串（id 仍取 store.list 的 id）
 * - 各字段类型不对（display 非字符串、kind 非枚举等）→ 兜底空串
 */
function extractCard(id: string, manifest: unknown): EmployeeCard {
  const empty: EmployeeCard = { id, display: '', brief: '', avatar: '', kind: '', version: '' }
  if (typeof manifest !== 'object' || manifest === null) return empty
  const m = manifest as Record<string, unknown>
  return {
    id,
    display: typeof m['display'] === 'string' ? m['display'] : '',
    brief: typeof m['brief'] === 'string' ? m['brief'] : '',
    avatar: typeof m['avatar'] === 'string' ? m['avatar'] : '',
    kind: typeof m['kind'] === 'string' ? m['kind'] : '',
    version: typeof m['version'] === 'string' ? m['version'] : '',
  }
}

/** GET /api/employees —— 花名册扫描派生（store.list → 卡片字段 + invalid 透传） */
export function employeesListHandler(deps: EmployeesRouteDeps) {
  return (_ctx: Ctx): Res => {
    const items = deps.store.list().map(({ id, manifest }) => extractCard(id, manifest))
    return { status: 200, json: { items, invalid: deps.store.invalid } }
  }
}

/** employees 域注册（只注册本域端点；汇总见 routes/index.ts） */
export function registerEmployeesRoutes(reg: RouteRegistry, deps: EmployeesRouteDeps): void {
  reg.post('/api/employees/generate', employeesGenerateHandler(deps))
  reg.get('/api/employees/validate-id', employeesValidateIdHandler(deps))
  reg.get('/api/employees', employeesListHandler(deps))
}
