/**
 * 卸载（设计 §8；S1 §8 条款 6 顺序）：manifest 清单删（hash 一致删/手改不一致默认留）→
 * 域目录清空 → memory/sessions 迁移 .unclaimed/<id>-<ts>/（用户资产不销毁）→ registry 行删除。
 * merge 摘除：域内 settings.json 是本安装产物（config 域私有），随域删除——回退档 workdir merge 的
 * _devzero 摘除在 workdir 清理路径（V0.1 主路径无此形态，回退档启用时补）。
 * null = 无该 Deployment（幂等 no-op，设计 §8 验收）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseId } from '../../adapters/contract'
import { sha256File, manifestPath, type InstallManifest } from '../manifest'
import { createDeploymentRegistry } from '../registry/registry'
import type { InstallServiceDeps } from '../service'

export interface UninstallResult {
  /** 已清理路径（home 相对或绝对） */
  cleaned: string[]
  /** 检出手工改动默认保留（末附备份去向说明行） */
  kept: string[]
  /** 无法程序化处理（merge 解析失败等；V0.1 主路径无此形态，占位） */
  manual: string[]
  /** memory/sessions 迁移目标（.unclaimed/<id>-<ts>/；无用户资产为 null） */
  memory_moved_to: string | null
}

export function uninstallEmployee(
  deps: InstallServiceDeps,
  input: { employeeId: string; base: BaseId; force?: boolean },
): UninstallResult | null {
  const registry = createDeploymentRegistry(deps.registryFile)
  const rec = registry.find(input.base, input.employeeId)
  if (!rec) return null

  const home = rec.home
  const cleaned: string[] = []
  const kept: string[] = []
  const manual: string[] = []

  // ① 产物清理判定（manifest 为清单真源）：hash 一致删；手改默认保留进 kept（force 强删）
  if (existsSync(manifestPath(home))) {
    const manifest = JSON.parse(readFileSync(manifestPath(home), 'utf8')) as InstallManifest
    for (const f of manifest.files) {
      const abs = join(home, f.path)
      if (!existsSync(abs)) continue
      let dirty = false
      try { dirty = sha256File(abs) !== f.sha256 } catch { dirty = true }
      if (dirty && !input.force) { kept.push(f.path); continue }
      cleaned.push(f.path)
    }
  }

  // ② kept 备份拷出到 .unclaimed/<id>-kept-<ts>/（必须在域整清之前——config/ 整删会连带删掉 kept 文件）
  if (kept.length > 0) {
    const keptDir = join(deps.staffRoot, '.unclaimed', `${input.employeeId}-kept-${Date.now()}`)
    mkdirSync(keptDir, { recursive: true })
    for (const k of kept) {
      const abs = join(home, k)
      if (existsSync(abs)) cpSync(abs, join(keptDir, k.split('/').pop()!), { recursive: true })
    }
    kept.push(`（已备份至 ${keptDir}）`)
  }

  // ③ 域内容整清（config/ + reports/ + .transaction/ + manifest 本体）
  if (existsSync(join(home, 'config'))) rmSync(join(home, 'config'), { recursive: true, force: true })
  if (existsSync(join(home, 'reports'))) rmSync(join(home, 'reports'), { recursive: true, force: true })
  if (existsSync(join(home, '.transaction'))) rmSync(join(home, '.transaction'), { recursive: true, force: true })
  if (existsSync(manifestPath(home))) rmSync(manifestPath(home), { force: true })
  cleaned.push('config/', 'reports/', '.devzero-manifest.json')

  // ④ memory/sessions 迁移（用户资产不销毁——设计 §8 ⑤）→ .unclaimed/<id>-<ts>/
  let memoryMovedTo: string | null = null
  const hasMemory = existsSync(join(home, 'memory')) || existsSync(join(home, 'sessions'))
  if (hasMemory) {
    memoryMovedTo = join(deps.staffRoot, '.unclaimed', `${input.employeeId}-${Date.now()}`)
    mkdirSync(memoryMovedTo, { recursive: true })
    for (const d of ['memory', 'sessions']) {
      if (existsSync(join(home, d))) cpSync(join(home, d), join(memoryMovedTo, d), { recursive: true })
    }
  }

  // ⑤ home 整删
  rmSync(home, { recursive: true, force: true })

  // ⑥ registry 行删除
  registry.remove(input.base, input.employeeId)

  return { cleaned, kept, manual, memory_moved_to: memoryMovedTo }
}
