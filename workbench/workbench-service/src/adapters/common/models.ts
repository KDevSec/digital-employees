/** listModels 静态桩（设计 §4.4 ⏳；M2 清单 6 实测底座配置获取方式后替换） */
import type { BaseId, ModelInfo } from '../contract'
import { resolveTierModel, TIER_ORDER } from './tier-map'

export async function listModelsFor(base: BaseId): Promise<ModelInfo[]> {
  // 桩 = tier-map 展平（五档各一条：同 id 不同档是发起表单的不同可选项，D-046；完全重复条目才去重）
  const seen = new Map<string, ModelInfo>()
  for (const tier of TIER_ORDER) {
    const m = resolveTierModel(base, tier)
    const key = `${m.id}#${m.tier}`
    if (!seen.has(key)) seen.set(key, m)
  }
  return [...seen.values()]
}
