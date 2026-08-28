/**
 * 底座域 API（D-bb01）：卡片 / 刷新探测 / 真模型 / npm 安装。
 * 手法沿 api/platform-config.ts：同源相对路径 + 超时 + 失败归一不抛。
 * 页面只展示 CB+Qoder（PAGE_BASE_IDS）；claude-code 适配器保留、本页过滤。
 */

export const PAGE_BASE_IDS = ['codebuddy', 'qoder'] as const
export type PageBaseId = (typeof PAGE_BASE_IDS)[number]

export interface BaseCard {
  id: string
  label: string
  present: boolean
  version: string | null
  version_tested: string
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

export interface ModelInfo {
  id: string
  label: string
  tier?: string
}

export type ModelsResult =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; code: 'NOT_LOGGED_IN' | 'CLI_FAILED' | 'FETCH_FAILED'; message: string }

export type InstallResult =
  | { ok: true; logs: string; presence: { present: boolean; version: string | null; probed_at: string } }
  | { ok: false; code: string; message: string; logs?: string }

const LIST_TIMEOUT_MS = 15_000
const MODELS_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 5 * 60_000

async function getJson(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchBases(): Promise<BaseCard[] | null> {
  try {
    const res = await getJson('/api/bases', {}, LIST_TIMEOUT_MS)
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as unknown
    return Array.isArray(data) ? data as BaseCard[] : null
  } catch {
    return null
  }
}

export async function probeBases(): Promise<boolean> {
  try {
    const res = await getJson('/api/bases/probe', { method: 'POST' }, LIST_TIMEOUT_MS)
    return res.ok
  } catch {
    return false
  }
}

export async function fetchModels(id: string): Promise<ModelsResult> {
  try {
    const res = await getJson(`/api/bases/${id}/models`, {}, MODELS_TIMEOUT_MS)
    const data = (await res.json().catch(() => null)) as unknown
    if (res.status === 403 && data && typeof data === 'object' && 'error' in data) {
      const err = (data as { error?: { code?: string; message?: string } }).error
      if (err?.code === 'NOT_LOGGED_IN') {
        return { ok: false, code: 'NOT_LOGGED_IN', message: err.message ?? '登录后可见' }
      }
    }
    if (!res.ok) {
      const err = data && typeof data === 'object' && 'error' in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : undefined
      return {
        ok: false,
        code: err?.code === 'CLI_FAILED' ? 'CLI_FAILED' : 'FETCH_FAILED',
        message: err?.message ?? '模型列表不可用',
      }
    }
    if (!Array.isArray(data)) return { ok: false, code: 'FETCH_FAILED', message: '模型列表不可用' }
    return { ok: true, models: data as ModelInfo[] }
  } catch {
    return { ok: false, code: 'FETCH_FAILED', message: '模型列表不可用' }
  }
}

/** 任务表单只向已登记「模型发现」命令的底座拉 CLI 列表；CC 档位桩不当 CLI 真模型。 */
export function shouldFetchCliModels(base: string): boolean {
  return base === 'qoder' || base === 'codebuddy'
}

/** 发起任务表单：未登录给提示、不把空列表当「无模型」；成功则给出底座真实模型。 */
export function modelSelectFromResult(result: ModelsResult | undefined): { hint: string; models: ModelInfo[] } {
  if (!result) return { hint: '', models: [] }
  if (result.ok) return { hint: '', models: result.models }
  if (result.code === 'NOT_LOGGED_IN') return { hint: '登录后可见', models: [] }
  return { hint: result.message, models: [] }
}

/** 切底座后异步探测可能过期：已换底座则丢弃，避免上一底座 CLI id 回填。 */
export function cliSelectAfterFetch(
  requestedBase: string,
  currentBase: string,
  result: ModelsResult,
): { hint: string; models: ModelInfo[] } | null {
  if (requestedBase !== currentBase) return null
  return modelSelectFromResult(result)
}

export async function installBase(id: string): Promise<InstallResult> {
  try {
    const res = await getJson(`/api/bases/${id}/install`, { method: 'POST' }, INSTALL_TIMEOUT_MS)
    const data = (await res.json().catch(() => ({}))) as {
      logs?: string
      presence?: { present: boolean; version: string | null; probed_at: string }
      error?: { code?: string; message?: string }
    }
    if (!res.ok) {
      return {
        ok: false,
        code: data.error?.code ?? 'NPM_INSTALL_FAILED',
        message: data.error?.message ?? '安装失败',
        logs: data.logs,
      }
    }
    return {
      ok: true,
      logs: data.logs ?? '',
      presence: data.presence ?? { present: false, version: null, probed_at: '' },
    }
  } catch (error) {
    return { ok: false, code: 'FETCH_FAILED', message: error instanceof Error ? error.message : '安装失败' }
  }
}
