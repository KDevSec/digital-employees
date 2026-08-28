import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { configSchema, defaultConfig } from './schema'
import type { WorkbenchConfig } from './schema'

const CONFIG_FILE = 'config.json'
const SAMPLE_FILE = 'config.sample.json'
/** 顶层注释键：sample 带注释，用户文件若残留则宽松忽略（设计 §5.3） */
const COMMENT_KEY = '_comment'

/**
 * 读取 `<profileDir>/config.json`：
 * - 不存在 → 全默认
 * - 存在 → JSON.parse → configSchema.parse（非法即抛 ZodError）
 */
export function loadConfig(profileDir: string): WorkbenchConfig {
  const configPath = join(profileDir, CONFIG_FILE)
  if (!existsSync(configPath)) return structuredClone(defaultConfig)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`配置文件不是合法 JSON: ${configPath}`, { cause: err })
  }
  if (isPlainObject(raw) && COMMENT_KEY in raw) {
    const { [COMMENT_KEY]: _comment, ...rest } = raw
    return configSchema.parse(rest)
  }
  return configSchema.parse(raw)
}

/**
 * 生成 `config.sample.json`（含 `_comment` 说明 + 全量默认值）。
 * 返回 sample 文件路径。
 */
export function writeSample(profileDir: string): string {
  mkdirSync(profileDir, { recursive: true })
  const sample: Record<string, unknown> = {
    _comment: 'DevZero 配置示例：复制为 config.json 后按需修改，未写出的项走内置默认值。',
    ...defaultConfig,
  }
  const samplePath = join(profileDir, SAMPLE_FILE)
  writeFileSync(samplePath, JSON.stringify(sample, null, 2) + '\n', 'utf8')
  return samplePath
}

/**
 * 覆盖写入形状（I0-5 T8：本线只开 platform.baseUrl——设计 D-13/D-14；后续配置写入键在此扩展）。
 * type 别名（非 interface）：可隐式赋给 Record<string, unknown>（deepMerge 入参），interface 无索引签名会 TS2322。
 */
export type ConfigOverrides = {
  platform: { baseUrl?: string; insecureTls?: boolean }
}

/**
 * 覆盖写入 `<profileDir>/config.json`（I0-5 T8，设计 D-13：写入只落覆盖键、保留既有键）：
 * 读现文件（不存在则空对象）→ 深合并覆盖键（嵌套普通对象按键递归合并，叶子直接覆盖；
 * `_comment` 等未涉及键原样保留）→ 原子写（tmp+rename，沿 runtime/contracts atomicWrite 手法）。
 * 现文件存在但非法 JSON / 根节点非对象 → 抛错拒绝覆盖（不静默吞掉用户既有配置，D-13 保守面）。
 */
export function writeConfigOverride(profileDir: string, overrides: ConfigOverrides): void {
  const configPath = join(profileDir, CONFIG_FILE)
  let existing: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (err) {
      throw new Error(`配置文件不是合法 JSON，拒绝覆盖写入: ${configPath}`, { cause: err })
    }
    if (!isPlainObject(raw)) {
      throw new Error(`配置文件根节点必须是 JSON 对象，拒绝覆盖写入: ${configPath}`)
    }
    existing = raw
  }
  const merged = deepMerge(existing, overrides)
  mkdirSync(profileDir, { recursive: true })
  const tmpPath = `${configPath}.${randomUUID()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  renameSync(tmpPath, configPath)
}

/** 深合并：嵌套普通对象按键递归合并，其余（原始值/数组/对象与非对象相遇）直接覆盖 */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key]
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value) : value
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
