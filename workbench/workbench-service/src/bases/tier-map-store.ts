/** 底座全局档位表（V0.1）：~/.devzero/bases/<base>-tiers.json，与探测缓存同目录不同文件。
 * 空档 = 跟随 CLI 默认。不校验是否仍在探测名单（漂移 id 保留，UI 标「不在当前列表」）。 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyTierMap, TIER_ORDER, type BaseTierMap } from '../adapters/common/tier-map'

export type { BaseTierMap }

export function tierMapFile(cacheDir: string, base: string): string {
  return join(cacheDir, `${base}-tiers.json`)
}

export function readTierMap(cacheDir: string, base: string): BaseTierMap {
  const out = emptyTierMap()
  const file = tierMapFile(cacheDir, base)
  if (!existsSync(file)) return out
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    const rec = raw as Record<string, unknown>
    for (const tier of TIER_ORDER) {
      const value = rec[tier]
      if (typeof value === 'string') out[tier] = value
    }
    return out
  } catch {
    return out
  }
}

export function writeTierMap(cacheDir: string, base: string, map: BaseTierMap): BaseTierMap {
  const normalized = emptyTierMap()
  for (const tier of TIER_ORDER) {
    normalized[tier] = typeof map[tier] === 'string' ? map[tier] : ''
  }
  mkdirSync(cacheDir, { recursive: true })
  const file = tierMapFile(cacheDir, base)
  const tmp = `${file}.tmp-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
  if (existsSync(file)) unlinkSync(file) // Windows：rename 到已存在目标会抛（同 registry.ts）
  renameSync(tmp, file)
  return normalized
}
