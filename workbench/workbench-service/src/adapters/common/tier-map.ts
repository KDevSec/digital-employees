/** tier-map（D-046：档位 → 具体模型；1.0 五档名——协同编排 Q7）。
 * V0.1：claude-code 仍用页隐藏桩；CB/Qoder 读底座全局表（空档 = 不加 --model）。
 * 员工 manifest 覆盖层未接，分层保留。 */
import type { BaseId, ModelInfo } from '../contract'

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

const CLAUDE_CODE_STUB: Record<TierName, ModelInfo> = {
  评审安全档: { id: 'claude-opus-5', label: 'Opus 5（评审安全档）', tier: '评审安全档' },
  设计档: { id: 'claude-sonnet-5', label: 'Sonnet 5（设计档）', tier: '设计档' },
  探索档: { id: 'claude-opus-5', label: 'Opus 5（探索档）', tier: '探索档' },
  编码档: { id: 'claude-sonnet-5', label: 'Sonnet 5（编码档）', tier: '编码档' },
  执行档: { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5（执行档）', tier: '执行档' },
}

export function resolveTierModel(base: BaseId, tier: TierName): ModelInfo {
  if (base !== 'claude-code') {
    throw new Error(`档位桩仅 claude-code：${base}`)
  }
  return CLAUDE_CODE_STUB[tier]
}

/** CB/Qoder 空档 → undefined（调用方省略 --model）；CC 忽略 overlay 走桩。 */
export function resolveConfiguredModel(base: BaseId, tier: TierName, overlay: BaseTierMap): string | undefined {
  if (base === 'claude-code') return CLAUDE_CODE_STUB[tier].id
  const id = overlay[tier]?.trim()
  return id || undefined
}
