/** listModels（D-bb01）：有登记命令的底座走 CLI；未登录与空列表必须可区分。
 * 禁止读配置目录。CC 页隐藏仍用档位桩。
 *
 * 口径不同档，UI 不分流：
 * - Qoder `--list-models` = 当前用户可用（依赖登录）
 * - CodeBuddy `--help` = 本机当前下发的支持列表（远端可变、与登录无关；条数/成员不钉死）
 */
import type { BaseId, ModelInfo } from '../contract'
import { resolveTierModel, TIER_ORDER } from './tier-map'
import type { CmdRunner } from '../../bases/probe'

export type ListModelsResult =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; code: 'NOT_LOGGED_IN' | 'CLI_FAILED'; message: string }

/** 模型发现命令表。command 与各 adapter profile.command 同源字面量，避免 common 依赖具体 adapter。 */
const CLI_LIST_MODELS: Partial<Record<BaseId, { command: string; args: string[] }>> = {
  qoder: { command: 'qodercli', args: ['--list-models'] },
  codebuddy: { command: 'codebuddy', args: ['--help'] },
}

const NOT_LOGGED_IN_RE = /not logged in/i
const UNREGISTERED_MESSAGE = '模型命令尚未登记'
/** 防 help 说明文字混进 id（空白归一后按逗号切） */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9.\-]*$/i

function stubModels(base: BaseId): ModelInfo[] {
  const seen = new Map<string, ModelInfo>()
  for (const tier of TIER_ORDER) {
    const m = resolveTierModel(base, tier)
    const key = `${m.id}#${m.tier}`
    if (!seen.has(key)) seen.set(key, m)
  }
  return [...seen.values()]
}

function parseLineList(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || NOT_LOGGED_IN_RE.test(line)) continue
    const id = line.split(/\s+/)[0]
    if (!id) continue
    models.push({ id, label: id })
  }
  return models
}

/** CodeBuddy：从 `--help` 取 Currently supported 括号段。空白归一是防御性格式整理，不是折行 miss 的补丁。 */
export function parseCodebuddyHelp(stdout: string): ModelInfo[] {
  const normalized = stdout.replace(/\s+/g, ' ')
  const hit = normalized.match(/Currently supported:\s*\(([^)]*)\)/i)
  if (!hit) return []
  const models: ModelInfo[] = []
  for (const raw of hit[1].split(',')) {
    const id = raw.trim()
    if (!id || !MODEL_ID_RE.test(id)) continue
    models.push({ id, label: id })
  }
  return models
}

async function listFromCli(
  base: BaseId,
  spec: { command: string; args: string[] },
  run: CmdRunner,
): Promise<ListModelsResult> {
  try {
    const { code, stdout, stderr } = await run(spec.command, spec.args)
    const text = `${stdout}\n${stderr ?? ''}`
    if (NOT_LOGGED_IN_RE.test(text)) {
      return { ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' }
    }
    if (code !== 0) {
      return { ok: false, code: 'CLI_FAILED', message: text.trim() || `${spec.command} ${spec.args.join(' ')} exit ${code}` }
    }
    const models = base === 'codebuddy' ? parseCodebuddyHelp(stdout) : parseLineList(stdout)
    if (base === 'codebuddy' && models.length === 0) {
      return { ok: false, code: 'CLI_FAILED', message: UNREGISTERED_MESSAGE }
    }
    return { ok: true, models }
  } catch {
    return { ok: false, code: 'CLI_FAILED', message: `${spec.command} ${spec.args.join(' ')} 执行失败` }
  }
}

export async function listModelsFor(base: BaseId, run?: CmdRunner): Promise<ListModelsResult> {
  const cli = CLI_LIST_MODELS[base]
  if (cli) {
    if (!run) return { ok: false, code: 'CLI_FAILED', message: '缺少命令执行器' }
    return listFromCli(base, cli, run)
  }
  if (base === 'claude-code') return { ok: true, models: stubModels(base) }
  return { ok: false, code: 'CLI_FAILED', message: UNREGISTERED_MESSAGE }
}

export function unwrapListModels(result: ListModelsResult): ModelInfo[] {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result.models
}
