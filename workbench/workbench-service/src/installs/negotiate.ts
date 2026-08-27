/**
 * 能力协商（设计 §6.1 ① / 概要设计 §4.1 算法）：effective = profile ∪ probe（探测覆盖静态声明，B-7——
 * 本任务 probe 输入面 = 在场性 + 版本；能力级探测覆盖为探测任务扩展点）。
 * reachable 判定：L1 需 skill-def；L2 需 slash-command+bash-exec+fs-access+subagent-dispatch 全集；
 * 与 spec.requires.level 取小。missing_required ≠ ∅ 或版本断言不符 → blocked（一等安装期错误）。
 *
 * 能力分档语义（对齐 UPP optional 降级映射）：
 * - 内容性能力（agent-def / fs-access / skill-def——员工定义、文件访问、技能包体）：缺失 = 员工本体
 *   装不上 → missing_required → 必装失败；
 * - 编排行为能力（bash-exec / slash-command / subagent-dispatch——运行期编排特性）：缺失 = reachable
 *   降级（degraded-subagent），不进 missing_required。
 */
import type { BaseProfile } from '../adapters/contract'
import type { EmployeeSpec } from './spec/types'

export interface ProbeResult { present: boolean; version: string | null }

export interface NegotiationResult {
  design_level: 'L0' | 'L1' | 'L2'
  reachable_level: 'L0' | 'L1' | 'L2'
  missing_required: string[]
  degraded: { capability: string; tag: string; ui_text: string }[]
  warnings: { code: string; text: string }[]
  /** 一等安装期错误（missing_required / 版本断言不符 / 底座不在场），null = 可安装 */
  blocked: { code: string; message: string; hint: string } | null
}

/** L2 可达需全集的能力（L1 需 skill-def；fs-access 兼属内容性底线） */
const L2_SET = ['slash-command', 'bash-exec', 'fs-access', 'subagent-dispatch']
/** 编排行为能力——缺失走 reachable 降级（UPP optional 降级映射），不算 missing_required */
const DEGRADABLE_SET = new Set(['bash-exec', 'slash-command', 'subagent-dispatch'])

const DEGRADED_TEXT: Record<string, string> = {
  'degraded-subagent': '子会话派发不可用，使用深度 L2 不可达，按 L1 交付',
  'degraded-mcp': 'MCP 连接器不可用，依赖这些连接器的 skill 将条件跳过',
  'degraded-cqo': '实时合规拦截不可用，退化为编排层 checkpoint 深审',
  'degraded-memory': '记忆实时落盘不可用，退化为节点边界落盘',
  'degraded-hud': '底座内状态栏不可用，进度改在终端 Web 查看',
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  }
  return 0
}

function cmpLevel(l: 'L0' | 'L1' | 'L2'): number {
  return { L0: 0, L1: 1, L2: 2 }[l]
}

export function negotiate(spec: EmployeeSpec, profile: BaseProfile, probe: ProbeResult): NegotiationResult {
  const warnings: NegotiationResult['warnings'] = []

  if (!probe.present) {
    return {
      design_level: spec.requires.level,
      reachable_level: 'L0',
      missing_required: spec.requires.capabilities,
      degraded: [],
      warnings,
      blocked: { code: 'BASE_NOT_PRESENT', message: `底座 ${profile.label}（${profile.command}）不在场`, hint: `请先安装底座 CLI：${profile.command}` },
    }
  }

  const ver = probe.version ?? '0.0.0'
  if (cmpSemver(ver, profile.version_min) < 0) {
    return {
      design_level: spec.requires.level,
      reachable_level: 'L0',
      missing_required: spec.requires.capabilities,
      degraded: [],
      warnings,
      blocked: { code: 'BASE_VERSION_UNSUPPORTED', message: `底座版本 ${ver} 低于支持下限 ${profile.version_min}（实测基线 ${profile.version_tested}）`, hint: '升级底座 CLI 后重试' },
    }
  }
  if (ver.split('.')[0] !== profile.version_tested.split('.')[0]) {
    warnings.push({ code: 'VERSION_MAJOR_DRIFT', text: `底座 major 版本 ${ver} 与实测基线 ${profile.version_tested} 不一致，能力按探测结果判定` })
  }
  if (ver !== profile.version_tested) {
    warnings.push({ code: 'VERSION_DRIFT', text: `底座版本 ${ver} ≠ 适配器验证版本 ${profile.version_tested}` })
  }

  const effective = new Set(profile.provides)
  const missing_required = spec.requires.capabilities.filter((c) => !effective.has(c) && !DEGRADABLE_SET.has(c))
  if (missing_required.length > 0) {
    return {
      design_level: spec.requires.level,
      reachable_level: 'L0',
      missing_required,
      degraded: [],
      warnings,
      blocked: { code: 'MISSING_REQUIRED_CAPABILITY', message: `底座 ${profile.label} 缺必需能力：${missing_required.join(', ')}`, hint: '该底座版本不支持此员工所需能力' },
    }
  }

  let reachable: 'L0' | 'L1' | 'L2' = 'L0'
  if (effective.has('skill-def')) reachable = 'L1'
  if (L2_SET.every((c) => effective.has(c))) reachable = 'L2'
  reachable = cmpLevel(reachable) < cmpLevel(spec.requires.level) ? reachable : spec.requires.level

  const degraded: NegotiationResult['degraded'] = []
  if (reachable === 'L1' && spec.requires.level === 'L2') {
    degraded.push({ capability: 'subagent-dispatch', tag: 'degraded-subagent', ui_text: DEGRADED_TEXT['degraded-subagent'] })
  }
  if (spec.connectors.length > 0 && !effective.has('mcp')) {
    degraded.push({ capability: 'mcp', tag: 'degraded-mcp', ui_text: DEGRADED_TEXT['degraded-mcp'] })
  }

  return { design_level: spec.requires.level, reachable_level: reachable, missing_required: [], degraded, warnings, blocked: null }
}
