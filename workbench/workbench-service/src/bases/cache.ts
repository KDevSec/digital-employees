/** 探测缓存（设计 §9：~/.devzero/bases/<base>.json，30 分钟 TTL） */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BasePresence } from './probe'

const TTL_MS = 30 * 60 * 1000

export function readCache(cacheFile: string, ttlMs = TTL_MS): BasePresence | null {
  if (!existsSync(cacheFile)) return null
  try {
    const p = JSON.parse(readFileSync(cacheFile, 'utf8')) as BasePresence
    if (Date.now() - new Date(p.probed_at).getTime() > ttlMs) return null
    return p
  } catch {
    return null
  }
}

export function writeCache(cacheFile: string, presence: BasePresence): void {
  mkdirSync(dirname(cacheFile), { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(presence, null, 2), 'utf8')
}
