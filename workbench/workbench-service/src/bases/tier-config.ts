/**
 * 模型档位配置（D-062：tier -> model 映射从静态表升级为底座级用户配置）。
 * 存储：~/.devzero/bases/tier-config.json--只存用户覆盖值，形态 { [base]: { 五档: modelId } }；
 * 解析优先级 = 用户配置 > 内置默认（tier-map 校准表）。
 * 写入走读-改-写原子替换（tmp + rename--Windows rename 到已存在目标先 unlink，同 executor atomicWrite 口径）。
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BaseId } from '../adapters/contract'
import { TIER_MAP, TIER_ORDER, type TierName } from '../adapters/common/tier-map'

/** 全量配置文件形态（只存覆盖值；无覆盖的底座不入键） */
export type TierConfigFile = Partial<Record<BaseId, Partial<Record<TierName, string>>>>

/** 读配置文件（不存在 = {}；坏 JSON = fail loud 抛错--用户配置静默丢失比页面报错更糟） */
export function readTierConfig(file: string): TierConfigFile {
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TierConfigFile
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('根节点必须是对象')
    }
    return parsed
  } catch (e) {
    throw new Error(`模型档位配置文件无法解析（${file}）：${e instanceof Error ? e.message : String(e)}。请修正该文件，或 PUT 覆盖写以重建`)
  }
}

/** 合并解析：内置默认 + 用户覆盖 -> 五档全量映射 + 被覆盖档位清单 */
export function resolveTierConfig(file: string, base: BaseId): { tiers: Record<TierName, string>; customized: TierName[] } {
  const overrides = readTierConfig(file)[base] ?? {}
  const tiers = {} as Record<TierName, string>
  const customized: TierName[] = []
  for (const tier of TIER_ORDER) {
    const ov = overrides[tier]
    if (typeof ov === 'string' && ov.length > 0) {
      tiers[tier] = ov
      customized.push(tier)
    } else {
      tiers[tier] = TIER_MAP[base][tier].id
    }
  }
  return { tiers, customized }
}

/** 覆盖写单底座五档（读全量 -> 更新 base 段 -> 原子落盘）。
 *  去默认化存储：与内置默认相同的值不落盘（「改回默认」即取消定制，customized 保持「真实偏离」语义；
 *  代价：内置默认表升级后，此前恰等于旧默认的显式选择会被新默认吸收--可接受，重新保存即恢复）。 */
export function saveTierConfig(file: string, base: BaseId, tiers: Record<TierName, string>): void {
  const all = readTierConfig(file)
  const overrides: Partial<Record<TierName, string>> = {}
  for (const tier of TIER_ORDER) {
    if (tiers[tier] !== TIER_MAP[base][tier].id) overrides[tier] = tiers[tier]
  }
  if (Object.keys(overrides).length > 0) all[base] = overrides
  else delete all[base]
  const tmp = `${file}.tmp-${Date.now()}`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8')
  if (existsSync(file)) unlinkSync(file) // Windows：rename 到已存在目标会抛
  renameSync(tmp, file)
}

/** 配置文件路径约定（main.ts 装配用：bases 域目录下） */
export function tierConfigPath(basesDir: string): string {
  return join(basesDir, 'tier-config.json')
}
