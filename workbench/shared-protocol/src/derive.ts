// 派生函数：从 manifest 与 skill 素材推导底座所需 capabilities / optional / 工具并集
// 规则来源：员工新建设计 §4.1 推导表
import type { Manifest } from './manifest'

/**
 * deriveCapabilities：每 skill 的 description 首句汇成数组
 *  - 首句定义：按第一个句号/问号/感叹号截断（中英文标点均识别：。. ? ？ ! ！）
 *  - 无标点则取全文
 *  - 入参是技能清单（不读文件），调用方负责从 SKILL.md frontmatter 拿 description
 */
export function deriveCapabilities(
  skills: Array<{ name: string; description: string }>,
): string[] {
  return skills.map((s) => {
    const m = s.description.match(/^[^。.?!？！]+/)
    return m ? m[0] : s.description
  })
}

/**
 * deriveRequires：manifest → { capabilities, optional }
 *  capabilities 推导：
 *    恒有 'agent-def' + 'fs-access'
 *    skills 非空 → +'skill-def'
 *    orchestration 存在（有个人表）→ +'bash-exec' +'slash-command' +'subagent-dispatch'
 *  optional 推导：
 *    hooks.redlines 非空 → +'event:PreToolUse'
 *    connectors 非空 → +'mcp'
 */
export function deriveRequires(
  manifest: Manifest,
): { capabilities: string[]; optional: string[] } {
  const capabilities: string[] = ['agent-def', 'fs-access']
  if (manifest.skills.length > 0) capabilities.push('skill-def')
  if (manifest.orchestration) {
    capabilities.push('bash-exec', 'slash-command', 'subagent-dispatch')
  }
  const optional: string[] = []
  if (manifest.hooks.redlines.length > 0) optional.push('event:PreToolUse')
  if (manifest.connectors.length > 0) optional.push('mcp')
  return { capabilities, optional }
}

/**
 * aggregateTools：builtin ∪ connectorTools ∪ engineTools − deny
 *  - 顺序保持首见（先 builtin，再 connectorTools，再 engineTools）
 *  - deny 集合内的项不出现于结果
 *  - 去重：跨数组重复时只保留首见
 */
export function aggregateTools(
  builtin: string[],
  connectorTools: string[],
  engineTools: string[],
  deny: string[],
): string[] {
  const denySet = new Set(deny)
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...builtin, ...connectorTools, ...engineTools]) {
    if (denySet.has(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
