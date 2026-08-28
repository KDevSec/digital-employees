/**
 * 底座域 API：卡片 / 刷新探测 / 真模型 / npm 安装 / 全局档位表（/tiers）+ D-062 档位配置（/tier-config）。
 * 手法沿 api/platform-config.ts：同源相对路径 + 超时 + 失败归一不抛。
 * 底座页只展示 CB+Qoder（PAGE_BASE_IDS）；claude-code 适配器保留、本页过滤。
 * 任务发起 / 安装向导消费 GET /api/bases（失败归一空数组，调用方按空态渲染）。
 */

export const PAGE_BASE_IDS = ['codebuddy', 'qoder'] as const
export type PageBaseId = (typeof PAGE_BASE_IDS)[number]

/** 与 service BaseId 同形——DTO 对齐，不直接 import service 内部类型 */
export type BaseId = 'claude-code' | 'codebuddy' | 'qoder'

export interface BaseCard {
  id: BaseId
  label: string
  present: boolean
  version: string | null
  version_tested: string
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

export interface ProbeCard {
  base: BaseId
  present: boolean
  version: string | null
  probed_at: string
  supported: boolean
}

export interface ModelInfo {
  id: string
  label: string
  tier?: string
}

export const TIER_ORDER = ['评审安全档', '设计档', '探索档', '编码档', '执行档'] as const
export type TierName = (typeof TIER_ORDER)[number]
export type BaseTierMap = Record<TierName, string>

export function emptyTierMap(): BaseTierMap {
  return {
    评审安全档: '',
    设计档: '',
    探索档: '',
    编码档: '',
    执行档: '',
  }
}

export type ModelsResult =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; code: 'NOT_LOGGED_IN' | 'CLI_FAILED' | 'FETCH_FAILED'; message: string }

export type InstallResult =
  | { ok: true; logs: string; presence: { present: boolean; version: string | null; probed_at: string } }
  | { ok: false; code: string; message: string; logs?: string }

/** GET /api/bases/:id/tier-config 响应（D-062：合并后五档映射 + 真实偏离档位清单） */
export interface TierConfig {
  tiers: Record<string, string>
  customized: string[]
}

export type SaveTierConfigResult =
  | { ok: true; config: TierConfig }
  | { ok: false; error: string }

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

/** GET /api/bases。失败归一空数组（发起表单 / 安装向导按空态渲染）。 */
export async function fetchBases(): Promise<BaseCard[]> {
  try {
    const res = await getJson('/api/bases', {}, LIST_TIMEOUT_MS)
    if (!res.ok) return []
    const data = (await res.json().catch(() => null)) as unknown
    return Array.isArray(data) ? data as BaseCard[] : []
  } catch {
    return []
  }
}

/** POST /api/bases/probe。失败归一 false（不阻塞后续 fetchBases）。 */
export async function probeBases(base?: BaseId): Promise<boolean> {
  try {
    const init: RequestInit = { method: 'POST' }
    if (base) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify({ base })
    }
    const res = await getJson('/api/bases/probe', init, LIST_TIMEOUT_MS)
    return res.ok
  } catch {
    return false
  }
}

/** main D-062 别名：失败归一空数组（丢失未登录语义；任务弹窗请用 fetchModels）。 */
export async function fetchBaseModels(base: BaseId): Promise<ModelInfo[]> {
  const result = await fetchModels(base)
  return result.ok ? result.models : []
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

function parseTierMap(data: unknown): BaseTierMap | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const rec = data as Record<string, unknown>
  const out = emptyTierMap()
  for (const tier of TIER_ORDER) {
    if (typeof rec[tier] !== 'string') return null
    out[tier] = rec[tier]
  }
  return out
}

export async function fetchTierMap(id: string): Promise<BaseTierMap | null> {
  try {
    const res = await getJson(`/api/bases/${id}/tiers`, {}, LIST_TIMEOUT_MS)
    if (!res.ok) return null
    return parseTierMap(await res.json().catch(() => null))
  } catch {
    return null
  }
}

export async function saveTierMap(id: string, map: BaseTierMap): Promise<boolean> {
  try {
    const res = await getJson(
      `/api/bases/${id}/tiers`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(map),
      },
      LIST_TIMEOUT_MS,
    )
    return res.ok
  } catch {
    return false
  }
}

export async function fetchTierConfig(base: BaseId): Promise<TierConfig | null> {
  try {
    const res = await getJson(`/api/bases/${base}/tier-config`, {}, LIST_TIMEOUT_MS)
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const obj = data as TierConfig
    if (!obj.tiers || typeof obj.tiers !== 'object') return null
    return { tiers: obj.tiers, customized: Array.isArray(obj.customized) ? obj.customized : [] }
  } catch {
    return null
  }
}

export async function saveTierConfig(base: BaseId, tiers: Record<string, string>): Promise<SaveTierConfigResult> {
  try {
    const res = await getJson(
      `/api/bases/${base}/tier-config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers }),
      },
      LIST_TIMEOUT_MS,
    )
    const data = (await res.json().catch(() => null)) as unknown
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message
      return { ok: false, error: msg ?? `保存失败（HTTP ${res.status}）` }
    }
    const cfg = data as TierConfig
    return { ok: true, config: { tiers: cfg.tiers ?? tiers, customized: Array.isArray(cfg.customized) ? cfg.customized : [] } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误，保存失败' }
  }
}
