/**
 * bases 域 API 客户端（L1 员工新建线 Task 23 / W6 追加）：
 * 对齐 workbench-service/src/server/routes/bases.ts 真码契约：
 * - GET /api/bases → BaseCard[]（探测缓存优先；卡片字段：id/label/present/version/version_tested/
 *   supported/employees_count/last_install_at）
 * - POST /api/bases/probe body {base?} → 单底座为 ProbeCard 对象 / 缺省为 ProbeCard[]；
 *   仅作触发——探测结果回写缓存后，调用方应再 GET /api/bases 拉取刷新列表（BaseCard 形态更全）。
 *
 * 失败归一空数组（调用方按空态渲染）；不抛错——避免 onMounted 阶段抛错打断弹层。
 *
 * 禁词：本文件不含 UI 文案，无禁词约束。
 */

/** 底座 id（与 service BaseId 同形——DTO 对齐即可，不直接 import service 内部类型避免跨包类型耦合） */
export type BaseId = 'claude-code' | 'codebuddy' | 'qoder'

/** GET /api/bases 响应元素（与 service BaseCard 字段同形——bases.ts:30-41） */
export interface BaseCard {
  id: BaseId
  label: string
  present: boolean
  version: string | null
  version_tested: string
  /** 在场时的版本区间断言结论；不在场为 null（无从断言） */
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

/** POST /api/bases/probe 响应元素（与 service ProbeCard 字段同形——bases.ts:43-50） */
export interface ProbeCard {
  base: BaseId
  present: boolean
  version: string | null
  probed_at: string
  supported: boolean
}

/**
 * fetchBases：GET /api/bases → BaseCard[]。
 * 失败归一空数组（页面按空态渲染「未检测到任何底座」）。
 */
export async function fetchBases(): Promise<BaseCard[]> {
  try {
    const res = await fetch('/api/bases')
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data as BaseCard[]
  } catch {
    return []
  }
}

/**
 * probeBases：POST /api/bases/probe body {base?} → 单底座 ProbeCard / 缺省 ProbeCard[]。
 * 失败归一 null（调用方按需兜底——不阻塞后续 fetchBases 刷新）。
 */
export async function probeBases(base?: BaseId): Promise<ProbeCard | ProbeCard[] | null> {
  try {
    const body = base ? { base } : {}
    const res = await fetch('/api/bases/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as ProbeCard | ProbeCard[]
  } catch {
    return null
  }
}

/** GET /api/bases/:id/tier-config 响应（D-062：合并后五档映射 + 真实偏离档位清单） */
export interface TierConfig {
  tiers: Record<string, string>
  customized: string[]
}

/** ModelInfo（GET /api/bases/:id/models 响应元素——合并配置后展平） */
export interface ModelInfo {
  id: string
  label: string
  tier?: string
}

/**
 * fetchTierConfig：GET /api/bases/:id/tier-config → 合并后五档映射。
 * 失败归一 null（面板按空态渲染）。
 */
export async function fetchTierConfig(base: BaseId): Promise<TierConfig | null> {
  try {
    const res = await fetch(`/api/bases/${base}/tier-config`)
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const obj = data as TierConfig
    if (!obj.tiers || typeof obj.tiers !== 'object') return null
    return { tiers: obj.tiers, customized: Array.isArray(obj.customized) ? obj.customized : [] }
  } catch {
    return null
  }
}

/** saveTierConfig 结果：成功回传服务端合并后配置；失败带 error.message（常驻文案） */
export type SaveTierConfigResult =
  | { ok: true; config: TierConfig }
  | { ok: false; error: string }

/**
 * saveTierConfig：PUT /api/bases/:id/tier-config body {tiers: 五档全量}。
 * 成功：ok + 服务端合并响应；失败：ok=false + 服务端 error.message（兜底文案）。
 */
export async function saveTierConfig(base: BaseId, tiers: Record<string, string>): Promise<SaveTierConfigResult> {
  try {
    const res = await fetch(`/api/bases/${base}/tier-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiers }),
    })
    const data = (await res.json()) as unknown
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

/**
 * fetchBaseModels：GET /api/bases/:id/models → 候选模型清单（合并配置后展平）。
 * 失败归一空数组（下拉空态）。
 */
export async function fetchBaseModels(base: BaseId): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`/api/bases/${base}/models`)
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data as ModelInfo[]
  } catch {
    return []
  }
}
