/**
 * F-03 登录与接入页的数据层（I0-5 T2，设计 §3 迁移映射 + D-8）：
 * 语义唯一权威 = workbench-demo/src/ui.ts（状态映射/动作端点）+ server.ts L146-162（/api/state 响应形状）。
 * statusLabel / statusBadgeClass / parseStateJson 为纯函数（无 DOM / 无网络，单测覆盖）；
 * fetchAccessState 沿 api/health.ts 手法：同源相对路径 + 2s 超时 + 失败归一 null。
 * 动作端点集中本文件一处（G-2/G-3 已落设计文档 §4 待裁决，A 系列定稿后单点改）。
 */

/** 接入状态枚举（demo state-store.ts WorkbenchState['status'] 八态） */
export type AccessStatus =
  | 'NEW'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'COMPLETED'
  | 'ACTIVE'
  | 'REJECTED'
  | 'REVOKED'
  | 'ERROR'

const ACCESS_STATUSES: readonly AccessStatus[] = [
  'NEW',
  'PENDING_REVIEW',
  'APPROVED',
  'COMPLETED',
  'ACTIVE',
  'REJECTED',
  'REVOKED',
  'ERROR',
]

/** /api/state 的 user 字段（demo = OIDC ID token claims，前端只消费三项展示性 claim） */
export interface AccessUser {
  name?: string
  preferred_username?: string
  email?: string
}

/** /api/state 消费形状（demo server.ts L160：{...state, privateJwk/publicJwk 剥离, authenticated, user}） */
export interface AccessState {
  installationId: string
  enrollmentId?: string
  workbenchId?: string
  status: AccessStatus
  lastHeartbeatAt?: string
  rejectionReason?: string
  error?: string
  authenticated: boolean
  user?: AccessUser
}

/** 动作调用结果（demo call() 的 messageNode 语义：成功「操作成功」，失败透传服务端 error.message） */
export interface ActionResult {
  ok: boolean
  message: string
}

/** 状态中文映射（demo ui.ts L25 原样照搬，未知值原样返回） */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    NEW: '未提交',
    PENDING_REVIEW: '待审批',
    APPROVED: '已批准待激活',
    COMPLETED: '已完成注册',
    ACTIVE: '已激活',
    REJECTED: '已拒绝',
    REVOKED: '已吊销',
    ERROR: '提交失败',
  }
  return labels[status] ?? status
}

/** 徽章语义类（demo badge CSS 类语义等价迁移：绿/黄/红/灰） */
export function statusBadgeClass(status: string): 'ok' | 'pending' | 'error' | 'neutral' {
  if (status === 'ACTIVE') return 'ok'
  if (status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'COMPLETED') return 'pending'
  if (status === 'REJECTED' || status === 'ERROR' || status === 'REVOKED') return 'error'
  return 'neutral'
}

function isAccessStatus(value: unknown): value is AccessStatus {
  return typeof value === 'string' && (ACCESS_STATUSES as readonly string[]).includes(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseUser(value: unknown): AccessUser | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const user: AccessUser = {}
  if (typeof raw.name === 'string') user.name = raw.name
  if (typeof raw.preferred_username === 'string') user.preferred_username = raw.preferred_username
  if (typeof raw.email === 'string') user.email = raw.email
  return user
}

/**
 * /api/state 响应 JSON → AccessState（外部对象不可信容错，沿 api/health.ts 先例）：
 * - 非对象 → null；
 * - installationId 缺失/非字符串 → null（根标识缺失说明响应形状根本不对，整包拒绝走「不可达」路径）；
 * - status 非八枚举之一（含缺失/类型错）→ 归一 NEW：局部损坏仍可渲染状态卡其余字段，
 *   枚举降级保守取初始态「未提交」，不整包拒绝（与 installationId 的整包拒绝粒度不同，测试注明）；
 * - authenticated 非 true → false（保守默认，不授予能力）；
 * - 可选字符串字段类型错 → undefined；user 只取三个展示性 claim；
 * - 多余字段（privateJwk/publicJwk 等）一律剥离。
 */
export function parseStateJson(data: unknown): AccessState | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  if (typeof raw.installationId !== 'string') return null
  return {
    installationId: raw.installationId,
    enrollmentId: optionalString(raw.enrollmentId),
    workbenchId: optionalString(raw.workbenchId),
    status: isAccessStatus(raw.status) ? raw.status : 'NEW',
    lastHeartbeatAt: optionalString(raw.lastHeartbeatAt),
    rejectionReason: optionalString(raw.rejectionReason),
    error: optionalString(raw.error),
    authenticated: raw.authenticated === true,
    user: parseUser(raw.user),
  }
}

/**
 * 单次 /api/state 抓取（2s 超时，失败/非 2xx/形状不对归一 null）。
 * 同源相对路径请求（页面由服务自身伺服；dev 由 Vite 代理到 19980/19982）。
 */
export async function fetchAccessState(): Promise<AccessState | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch('/api/state', { signal: controller.signal })
    if (!res.ok) return null
    return parseStateJson(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 动作统一 POST 入口（demo call() 语义：Content-Type json、失败透传 error.message、
 * 成功文案「操作成功」；网络异常归一失败结果不抛出——demo 未捕获，SPA 侧统一归一）。
 */
async function postAction(path: string): Promise<ActionResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) {
      return { ok: false, message: data.error?.message ?? res.statusText }
    }
    return { ok: true, message: '操作成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '操作失败' }
  }
}

/** 重新提交接入申请（demo：POST /api/enroll） */
export function enrollAction(): Promise<ActionResult> {
  return postAction('/api/enroll')
}

/** 发送终端心跳（demo：POST /api/heartbeat） */
export function heartbeatAction(): Promise<ActionResult> {
  return postAction('/api/heartbeat')
}

/** 重置申请状态（demo：POST /api/reset；G-3 未入 v0.2 端点表，先按 demo 保留） */
export function resetAction(): Promise<ActionResult> {
  return postAction('/api/reset')
}

/** 退出登录（demo：POST /api/logout） */
export function logoutAction(): Promise<ActionResult> {
  return postAction('/api/logout')
}

/** 审批进度刷新（demo：POST /api/progress；G-2 与 v0.2 §5.2 的 GET 矛盾已落档待裁决） */
export function progressAction(): Promise<ActionResult> {
  return postAction('/api/progress')
}
