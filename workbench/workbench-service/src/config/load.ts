import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
