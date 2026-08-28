/** 底座在场探测（设计 §9）。CmdRunner 注入：生产 = Bun.spawn 包装（main.ts 装配），测试 = 桩。 */
import type { BaseProfile } from '../adapters/contract'

export interface BasePresence { present: boolean; version: string | null; probed_at: string }
export type CmdResult = { code: number; stdout: string; stderr?: string }
export type CmdRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<CmdResult> | CmdResult

const SEMVER_RE = /(\d+\.\d+\.\d+)/

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  }
  return 0
}

export async function probeBase(profile: BaseProfile, run: CmdRunner): Promise<BasePresence> {
  try {
    const { code, stdout } = await run(profile.command, ['--version'])
    if (code !== 0) return { present: false, version: null, probed_at: new Date().toISOString() }
    const m = stdout.match(SEMVER_RE)
    return { present: true, version: m ? m[1] : null, probed_at: new Date().toISOString() }
  } catch {
    return { present: false, version: null, probed_at: new Date().toISOString() }
  }
}

export function assertVersion(profile: BaseProfile, presence: BasePresence): { ok: boolean; warning?: string } {
  if (!presence.version) {
    return { ok: true, warning: `底座 ${profile.label} 版本不可解析（stdout 无 semver），跳过区间断言` }
  }
  if (cmpSemver(presence.version, profile.version_min) < 0) return { ok: false }
  if (presence.version.split('.')[0] !== profile.version_tested.split('.')[0]) {
    return { ok: true, warning: `底座 major 版本 ${presence.version} 与实测基线 ${profile.version_tested} 不一致` }
  }
  return { ok: true }
}
