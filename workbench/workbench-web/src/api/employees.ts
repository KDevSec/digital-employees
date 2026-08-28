/**
 * employees 域 API 客户端（L1 员工新建线 Task 16）：
 * - generateEmployee(draft)：POST /api/employees/generate body {draft:{manifest, skills}}
 *   200 → {package_path, files, manifest}；422 VALIDATION_FAILED → 抛 {code, field_errors}；
 *   409 ID_CONFLICT → 抛 {code:'ID_CONFLICT'}；422 SKILL_MISSING → 抛 {code:'SKILL_MISSING'}
 * - validateId(id)：GET /api/employees/validate-id?id= → {available, suggestion?}
 * - saveAsTemplate(draft)：POST /api/templates body {id, manifest, skills}
 *   service 端此端点尚未实现，前端按 spec §6 契约调用；404/失败 → 抛错由调用方 toast「保存模板服务未就绪」
 *
 * manifest 组装复用 useManifestValidation 的 buildManifestFromDraft（提取为共用函数——controller 裁决）。
 *
 * 禁词：本文件不含 UI 文案，无禁词约束。
 */
import type { WizardDraft } from '../stores/wizard'
import { buildManifestFromDraft } from '../composables/useManifestValidation'

/** generate 成功响应（与 service GenerateResult 同形） */
export interface GenerateResult {
  package_path: string
  files: string[]
  manifest: Record<string, unknown>
}

/** VALIDATION_FAILED 错误（携带 field_errors 供向导跳步） */
export interface ValidationFailedError {
  code: 'VALIDATION_FAILED'
  field_errors: Array<{ step: number; field: string; message: string }>
}

/** ID_CONFLICT 错误 */
export interface IdConflictError {
  code: 'ID_CONFLICT'
  message: string
}

/** SKILL_MISSING 错误 */
export interface SkillMissingError {
  code: 'SKILL_MISSING'
  message: string
}

/** 联合错误类型 */
export type EmployeeApiError = ValidationFailedError | IdConflictError | SkillMissingError

/** validate-id 响应 */
export interface ValidateIdResult {
  available: boolean
  suggestion?: string
}

/** 花名册卡片字段（GET /api/employees items 元素，与 service EmployeeCard 同形） */
export interface EmployeeCard {
  id: string
  display: string
  brief: string
  avatar: string
  kind: string
  version: string
  /** 已安装底座 id 列表（2026-08-28 后端扩展：installs registry 聚合） */
  hosts: string[]
}

/** GET /api/employees 响应：花名册扫描派生（items + invalid 透传） */
export interface EmployeesListResult {
  items: EmployeeCard[]
  invalid: string[]
}

/** saveAsTemplate 成功响应（与 service 模板元信息同形） */
export interface SaveTemplateResult {
  id: string
  display?: string
}

/**
 * generateEmployee：POST generate，三态处理。
 * - body：{draft: {manifest: buildManifestFromDraft(draft), skills: draft.skills}}
 * - 200 → 返回 GenerateResult
 * - 422 VALIDATION_FAILED → 抛 ValidationFailedError（含 field_errors 供向导跳步）
 * - 409 ID_CONFLICT → 抛 IdConflictError
 * - 422 SKILL_MISSING → 抛 SkillMissingError
 * - 其他/网络错 → 抛 {code: 'UNKNOWN', message}
 */
export async function generateEmployee(draft: WizardDraft): Promise<GenerateResult> {
  const manifest = buildManifestFromDraft(draft)
  const body = JSON.stringify({
    draft: {
      manifest,
      skills: draft.skills,
    },
  })
  const res = await fetch('/api/employees/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) {
    return data as unknown as GenerateResult
  }
  const code = data['code'] as string | undefined
  if (code === 'VALIDATION_FAILED') {
    throw {
      code: 'VALIDATION_FAILED',
      field_errors: (data['field_errors'] as ValidationFailedError['field_errors']) ?? [],
    } as ValidationFailedError
  }
  if (code === 'ID_CONFLICT') {
    throw { code: 'ID_CONFLICT', message: (data['message'] as string) ?? 'ID 已被占用' } as IdConflictError
  }
  if (code === 'SKILL_MISSING') {
    throw { code: 'SKILL_MISSING', message: (data['message'] as string) ?? 'skill 素材缺失' } as SkillMissingError
  }
  throw { code: 'UNKNOWN', message: (data['message'] as string) ?? `生成失败 (${res.status})` }
}

/**
 * validateId：GET /api/employees/validate-id?id= → {available, suggestion?}。
 * 失败归一 {available:true}（不阻塞用户输入——后端最终校验在 generate 时）。
 */
export async function validateId(id: string): Promise<ValidateIdResult> {
  try {
    const res = await fetch(`/api/employees/validate-id?id=${encodeURIComponent(id)}`)
    if (!res.ok) return { available: true }
    const data = (await res.json()) as ValidateIdResult
    return data
  } catch {
    return { available: true }
  }
}

/**
 * fetchEmployees：GET /api/employees → { items: EmployeeCard[], invalid: string[] }。
 * 花名册扫描派生视图（service store.list 驱动）；失败归一空列表（调用方按空态渲染）。
 */
export async function fetchEmployees(): Promise<EmployeesListResult> {
  try {
    const res = await fetch('/api/employees')
    if (!res.ok) return { items: [], invalid: [] }
    const data = (await res.json()) as EmployeesListResult
    if (!data || !Array.isArray(data.items)) return { items: [], invalid: [] }
    return {
      items: data.items,
      invalid: Array.isArray(data.invalid) ? data.invalid : [],
    }
  } catch {
    return { items: [], invalid: [] }
  }
}

/**
 * saveAsTemplate：POST /api/templates body {id, manifest, skills}。
 * service 端此端点尚未实现——前端按 spec §6 契约先行；任何失败（404 等）抛错由调用方 toast。
 */
export async function saveAsTemplate(draft: WizardDraft): Promise<SaveTemplateResult> {
  const manifest = buildManifestFromDraft(draft)
  const body = JSON.stringify({
    id: draft.id,
    manifest,
    skills: draft.skills,
  })
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) {
    return data as unknown as SaveTemplateResult
  }
  throw {
    code: 'TEMPLATE_SAVE_FAILED',
    status: res.status,
    message: (data['message'] as string) ?? `保存模板失败 (${res.status})`,
  }
}
