/**
 * hooks 编译器（Task 10 / B5）：redlines compiled + tools.deny → PreToolUse + W3 polyglot 命令格式。
 *
 * 输入：Manifest；输出：hooks.json 文本（JSON.stringify 两空格缩进，\n 行尾——JSON.parse 不区分行尾）；
 * null = 无 compiled 红线且 deny 空。
 *
 * 结构（与物料 hooks.json 既有结构一致）：
 *   {
 *     description: "由 devzero 从红线声明编译生成，请勿手改（重新生成会覆盖）。规则：{compiled 规则 id 逗号列表}（已定格，T10 2026-08-27）",
 *     hooks: {
 *       PreToolUse: [
 *         { matcher: "<matcher>", hooks: [{ type: "command", command: "\"${DEVZERO_HOOKS_ROOT}/redlines/run-hook.cmd\" <rule_id>.py", timeout: 5 }] }
 *       ]
 *     }
 *   }
 *
 * 命令格式（W3 规范锚）：`"${DEVZERO_HOOKS_ROOT}/redlines/run-hook.cmd" <rule_id>.py`
 * matcher 映射：
 *   no-push-to-main     → Bash
 *   no-devzero-state    → Write|Edit|MultiEdit|Bash
 *   no-external-request → Bash
 *   no-production-access→ Bash
 *   no-db-schema        → Write|Edit|MultiEdit
 *   high-risk-via-gate  → 无 matcher（人工闸语义，compiled=true 也不产出 PreToolUse）
 *
 * tools.deny 每项独立条目 matcher=该工具名；命令用合成 rule_id `deny-<tool>` 走同一 W3 命令格式。
 */
import type { Manifest } from '@devzero/shared-protocol'

/** 规则 rule_id → matcher 映射（W3 规范锚）。high-risk-via-gate 不在表内（人工闸语义，不产出）。 */
const RULE_MATCHERS: Record<string, string> = {
  'no-push-to-main': 'Bash',
  'no-devzero-state': 'Write|Edit|MultiEdit|Bash',
  'no-external-request': 'Bash',
  'no-production-access': 'Bash',
  'no-db-schema': 'Write|Edit|MultiEdit',
}

const DESCRIPTION_PREFIX = '由 devzero 从红线声明编译生成，请勿手改（重新生成会覆盖）。规则：'
const DESCRIPTION_SUFFIX = '（已定格，T10 2026-08-27）'
const HOOKS_ROOT = '${DEVZERO_HOOKS_ROOT}'
const TIMEOUT = 5

/** W3 polyglot 命令格式：`"${DEVZERO_HOOKS_ROOT}/redlines/run-hook.cmd" <rule_id>.py` */
function buildCommand(ruleId: string): string {
  return `"${HOOKS_ROOT}/redlines/run-hook.cmd" ${ruleId}.py`
}

/** PreToolUse 单条 hook 结构 */
interface PreToolUseEntry {
  matcher: string
  hooks: Array<{
    type: 'command'
    command: string
    timeout: number
  }>
}

/**
 * 编译 hooks.json。
 *
 * @param manifest 已 schema 校验的 Manifest
 * @returns hooks.json 文本（JSON.stringify 两空格缩进）；无 compiled 红线且 deny 空 → null
 */
export function compileHooks(manifest: Manifest): string | null {
  // 收集 compiled 红线条目（按 manifest.redlines 顺序；跳过 compiled=false 与无 matcher 映射的规则如 high-risk-via-gate）
  const compiledRedlines: string[] = []
  for (const r of manifest.hooks.redlines) {
    if (!r.compiled) continue
    if (!(r.rule_id in RULE_MATCHERS)) continue
    compiledRedlines.push(r.rule_id)
  }

  const deny = manifest.tools.deny
  const hasRedlines = compiledRedlines.length > 0
  const hasDeny = deny.length > 0

  // 无 compiled 红线且 deny 空 → null（不生成 hooks/hooks.json）
  if (!hasRedlines && !hasDeny) {
    return null
  }

  // 构建 PreToolUse 条目（先 compiled 红线、后 deny 条目）
  const preToolUse: PreToolUseEntry[] = []

  for (const ruleId of compiledRedlines) {
    const matcher = RULE_MATCHERS[ruleId]!
    preToolUse.push({
      matcher,
      hooks: [
        {
          type: 'command',
          command: buildCommand(ruleId),
          timeout: TIMEOUT,
        },
      ],
    })
  }

  for (const tool of deny) {
    // tools.deny 每项独立条目 matcher=该工具名；命令用合成 rule_id `deny-<tool>` 走同一 W3 命令格式
    preToolUse.push({
      matcher: tool,
      hooks: [
        {
          type: 'command',
          command: buildCommand(`deny-${tool}`),
          timeout: TIMEOUT,
        },
      ],
    })
  }

  // description 文案：compiled 规则 id 逗号列表 + T10 注记（对齐物料现有 description 风格）
  const ruleList = compiledRedlines.join(', ')
  const description = `${DESCRIPTION_PREFIX}${ruleList}${DESCRIPTION_SUFFIX}`

  const output = {
    description,
    hooks: {
      PreToolUse: preToolUse,
    },
  }

  return JSON.stringify(output, null, 2)
}
