/**
 * installs 域 API 客户端（L1 员工新建线 Task 23 / W6 追加）：
 * 对齐 workbench-service/src/server/routes/installs.ts 真码契约（zod schema：
 * executeSchema = {employee_id: string, base: BaseId}——三步链共用同一 body 形态）：
 * - POST /api/deployments/plan body {employee_id, base} → {negotiation, placements}（干跑：negotiate + plan 纯函数组装，零副作用）
 * - POST /api/deployments/execute body {employee_id, base} → InstallReport（含 result/error）
 * - POST /api/deployments/verify body {employee_id, base} → {drift: DriftItem[]}
 *
 * 错误形状统一：{ error: { code, message } }（与 service err() helper 同款）。
 * 三步链均抛错——由调用方按当前步失败展示真实错误（不走假成功）。
 *
 * 禁词：本文件不含 UI 文案，无禁词约束。
 */
import type { BaseId } from './bases'

/** 落位动作（与 service PlacementAction 同形——adapters/contract.ts:7） */
export type PlacementAction = 'copy' | 'convert' | 'merge' | 'symlink'

/** plan 响应 placements 元素（与 service Placement 同形——adapters/contract.ts:9-17） */
export interface Placement {
  source: string
  target: string
  action: PlacementAction
  /** merge 可空；copy/convert 单文件 sha256 */
  checksum?: string
}

/** 协商结果（与 service NegotiationResult 同形——installs/negotiate.ts:18-26） */
export interface NegotiationResult {
  design_level: 'L0' | 'L1' | 'L2'
  reachable_level: 'L0' | 'L1' | 'L2'
  missing_required: string[]
  degraded: { capability: string; tag: string; ui_text: string }[]
  warnings: { code: string; text: string }[]
  /** 一等安装期错误（missing_required / 版本断言不符 / 底座不在场），null = 可安装 */
  blocked: { code: string; message: string; hint: string } | null
}

/** plan 响应（与 service installs.ts:64 同形） */
export interface DeploymentPlanResult {
  negotiation: NegotiationResult
  placements: Placement[]
}

/** execute 响应（与 service InstallReport 同形——installs/report.ts:7-17） */
export interface InstallReport {
  report_version: 1
  employee_id: string
  package_version: string
  base: BaseId
  base_version: string
  base_version_tested: string
  scope: { type: 'deployment'; home: string }
  negotiation: NegotiationResult
  placements: { source: string; target: string; action: PlacementAction; conflict: null }[]
  result: 'success' | 'unchanged' | 'rolled-back' | 'failed'
  error?: { code: string; message: string; phase: string; recoverable: boolean; hint: string }
  started_at: string
  finished_at: string
}

/** verify 响应（与 service installs.ts:90 同形） */
export interface DriftItem {
  path: string
  kind: 'missing' | 'hash-mismatch' | 'extra'
}
export interface DeploymentVerifyResult {
  drift: DriftItem[]
}

/** 三步链共用的请求体组装 + 错误解析 */
async function postDeployment<T>(path: string, employeeId: string, base: BaseId): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employee_id: employeeId, base }),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } }
  if (!res.ok) {
    const message = data?.error?.message ?? `请求失败 (${res.status})`
    const code = data?.error?.code ?? 'UNKNOWN'
    throw { code, message, status: res.status } as { code: string; message: string; status: number }
  }
  return data as unknown as T
}

/** planDeployment：干跑——展示落位清单（source → target）+ 协商结论（blocked != null 时不可安装） */
export function planDeployment(employeeId: string, base: BaseId): Promise<DeploymentPlanResult> {
  return postDeployment<DeploymentPlanResult>('/api/deployments/plan', employeeId, base)
}

/** executeDeployment：执行安装——返回 InstallReport（result/error 透传供 UI 展示） */
export function executeDeployment(employeeId: string, base: BaseId): Promise<InstallReport> {
  return postDeployment<InstallReport>('/api/deployments/execute', employeeId, base)
}

/** verifyDeployment：校验和——drift 数组为空表示无漂移 */
export function verifyDeployment(employeeId: string, base: BaseId): Promise<DeploymentVerifyResult> {
  return postDeployment<DeploymentVerifyResult>('/api/deployments/verify', employeeId, base)
}
