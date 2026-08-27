/** tier-map（D-046 第四层：员工 manifest 档位 → 具体模型；1.0 五档名——协同编排 Q7）。
 * ⏳ 静态桩：真实模型清单获取方式 M2 实测后替换数据源（设计 §4.4）。 */
import type { BaseId, ModelInfo } from '../contract'

export const TIER_ORDER = ['评审安全档', '设计档', '探索档', '编码档', '执行档'] as const
export type TierName = (typeof TIER_ORDER)[number]

const TIER_MAP: Record<BaseId, Record<TierName, ModelInfo>> = {
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
    评审安全档: { id: 'qoder-max', label: 'Qoder Max（评审安全档）', tier: '评审安全档' },
    设计档: { id: 'qoder-pro', label: 'Qoder Pro（设计档）', tier: '设计档' },
    探索档: { id: 'qoder-max', label: 'Qoder Max（探索档）', tier: '探索档' },
    编码档: { id: 'qoder-pro', label: 'Qoder Pro（编码档）', tier: '编码档' },
    执行档: { id: 'qoder-lite', label: 'Qoder Lite（执行档）', tier: '执行档' },
  },
}

export function resolveTierModel(base: BaseId, tier: TierName): ModelInfo {
  return TIER_MAP[base][tier]
}
