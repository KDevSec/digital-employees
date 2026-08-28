/** tier-map（D-046：档位 → 具体模型；1.0 五档名——协同编排 Q7）。
 * V0.1：内置表给 D-062 /tier-config 当默认；CB/Qoder 页面空档 = 不加 --model（overlay）。
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

/** D-062 内置默认（qoder 按 --list-models 实测校准）。CB 假名仍在，页面不走这张表当列表。 */
export const TIER_MAP: Record<BaseId, Record<TierName, ModelInfo>> = {
  'claude-code': {
    评审安全档: { id: 'claude-opus-5', label: 'Opus 5（评审安全档）', tier: '评审安全档' },
    设计档: { id: 'claude-sonnet-5', label: 'Sonnet 5（设计档）', tier: '设计档' },
    探索档: { id: 'claude-opus-5', label: 'Opus 5（探索档）', tier: '探索档' },
    编码档: { id: 'claude-sonnet-5', label: 'Sonnet 5（编码档）', tier: '编码档' },
    执行档: { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5（执行档）', tier: '执行档' },
  },
  codebuddy: {
    评审安全档: { id: 'codebuddy-max', label: 'CodeBuddy Max（评审安全档）', tier: '评审安全档' },
    设计档: { id: 'codebuddy-pro', label: 'CodeBuddy Pro（设计档）', tier: '设计档' },
    探索档: { id: 'codebuddy-max', label: 'CodeBuddy Max（探索档）', tier: '探索档' },
    编码档: { id: 'codebuddy-pro', label: 'CodeBuddy Pro（编码档）', tier: '编码档' },
    执行档: { id: 'codebuddy-lite', label: 'CodeBuddy Lite（执行档）', tier: '执行档' },
  },
  qoder: {
    评审安全档: { id: 'Qwen3.8-Max', label: 'Qwen3.8-Max（评审安全档）', tier: '评审安全档' },
    设计档: { id: 'Qwen3.7-Max', label: 'Qwen3.7-Max（设计档）', tier: '设计档' },
    探索档: { id: 'Qwen3.8-Max', label: 'Qwen3.8-Max（探索档）', tier: '探索档' },
    编码档: { id: 'Qwen3.7-Plus', label: 'Qwen3.7-Plus（编码档）', tier: '编码档' },
    执行档: { id: 'Lite', label: 'Lite（执行档）', tier: '执行档' },
  },
}

export function resolveTierModel(base: BaseId, tier: TierName): ModelInfo {
  return TIER_MAP[base][tier]
}

/** CB/Qoder 空档 → undefined（调用方省略 --model）；CC 忽略 overlay 走桩。 */
export function resolveConfiguredModel(base: BaseId, tier: TierName, overlay: BaseTierMap): string | undefined {
  if (base === 'claude-code') return TIER_MAP[base][tier].id
  const id = overlay[tier]?.trim()
  return id || undefined
}
