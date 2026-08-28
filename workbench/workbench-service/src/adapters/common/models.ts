/** listModels 静态桩（设计 §4.4 ⏳；M2 清单 6 实测底座配置获取方式后替换）。
 *  overrides：用户档位配置（D-062--路由层传 resolveTierConfig 的覆盖段；缺省 = 内置默认） */
import type { BaseId, ModelInfo } from '../contract'
import { resolveTierModel, TIER_ORDER, type TierName } from './tier-map'

export async function listModelsFor(base: BaseId, overrides?: Partial<Record<TierName, string>>): Promise<ModelInfo[]> {
  // 桩 = tier-map 展平（五档各一条：同 id 不同档是发起表单的不同可选项，D-046；完全重复条目才去重）
  const seen = new Map<string, ModelInfo>()
  for (const tier of TIER_ORDER) {
    const m = resolveTierModel(base, tier)
    const ov = overrides?.[tier]
    const effective = typeof ov === 'string' && ov.length > 0
      ? { id: ov, label: `${ov}（${tier}）`, tier }
      : m
    const key = `${effective.id}#${effective.tier}`
    if (!seen.has(key)) seen.set(key, effective)
  }
  return [...seen.values()]
}
