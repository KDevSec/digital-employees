/**
 * 落位动作原语（设计 §6.1 ⑤；S1 §8 条款 2/3）：
 * - copy/convert：单文件先写临时文件再原子 rename（Windows：目标存在先 unlink）；
 *   copy 目标可为目录（skills 包体）→ 递归拷贝；
 * - merge：写前备份 → 程序化深合并（禁文本拼接）→ 本员工条目附 _devzero 标记；
 *   写后回读校验——自己写出的不合法 JSON 必须当场炸（底座容忍坏 JSON 静默半生效）；
 * - symlink：无特权 fallback 只读拷贝（P-12 软链优于拷贝，Windows 兼容降级）。
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Placement, PlacementAction, PlacementPlan } from '../../adapters/contract'
import { InstallError } from '../errors'

export interface ActionOutcome {
  target: string                     // home 相对路径
  action: PlacementAction
  backupPath?: string                // merge 的原文件备份（home 相对）
  createdDirs?: string[]             // 本动作新建目录（回滚删空目录用）
}

function atomicWrite(abs: string, content: string | Buffer): void {
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp-${Date.now()}`
  writeFileSync(tmp, content)
  if (existsSync(abs)) unlinkSync(abs)   // Windows：rename 到已存在目标会抛
  renameSync(tmp, abs)
}

/** 递归目录拷贝（skills 包体；非原子——失败清理由 undoPlacement 逆序回滚兜底） */
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dst, name)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

/**
 * 程序化深合并 + 本员工条目标记：
 * - patch 侧数组按条目合并——对象条目附 marker（_devzero）；
 *   已存在的同 marker 值且同 matcher 条目原位替换（同员工幂等重装不重复追加）；
 * - base 侧不存在的分支（空 settings.json 首装）同样走数组标记路径——
 *   标记注入不依赖 base 已有同形结构。
 */
export function deepMergeJson(base: unknown, patch: unknown, marker: { key: string; value: string }): unknown {
  if (Array.isArray(patch)) {
    const merged: unknown[] = Array.isArray(base) ? [...(base as unknown[])] : []
    for (const item of patch) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const i = merged.findIndex((m) =>
          m && typeof m === 'object' && !Array.isArray(m)
          && (m as Record<string, unknown>)[marker.key] === marker.value
          && sameHookMatcher(m, item))
        if (i >= 0) merged[i] = { ...(merged[i] as object), ...item, [marker.key]: marker.value }
        else merged.push({ ...item, [marker.key]: marker.value })
      } else {
        merged.push(item)
      }
    }
    return merged
  }
  if (patch && typeof patch === 'object') {
    const baseObj = base && typeof base === 'object' && !Array.isArray(base)
      ? (base as Record<string, unknown>)
      : {}
    const out: Record<string, unknown> = { ...baseObj }
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = deepMergeJson(baseObj[k], v, marker)
    }
    return out
  }
  return patch
}

function sameHookMatcher(a: unknown, b: unknown): boolean {
  const ma = (a as Record<string, unknown>)?.matcher
  const mb = (b as Record<string, unknown>)?.matcher
  return ma === undefined || mb === undefined || ma === mb
}

export function runPlacement(plan: PlacementPlan, placement: Placement, packageRoot: string): ActionOutcome {
  const srcAbs = join(packageRoot, placement.source)
  const dstAbs = join(plan.home, placement.target)
  if (!existsSync(srcAbs)) {
    throw new InstallError({ code: 'INSTALL_SOURCE_MISSING', message: `包内源缺失：${placement.source}`, phase: 'execute', recoverable: false, hint: '员工包不完整，重新构建包' })
  }
  if (placement.action === 'copy' || placement.action === 'convert') {
    if (placement.action === 'copy' && statSync(srcAbs).isDirectory()) {
      copyDir(srcAbs, dstAbs)
      return { target: placement.target, action: 'copy' }
    }
    let content: string | Buffer = readFileSync(srcAbs)
    if (placement.action === 'convert') {
      content = compileIdentity(content.toString(), plan)
    }
    atomicWrite(dstAbs, content)
    return { target: placement.target, action: placement.action }
  }
  if (placement.action === 'merge') {
    const patch = JSON.parse(readFileSync(srcAbs, 'utf8'))
    const base = existsSync(dstAbs) ? JSON.parse(readFileSync(dstAbs, 'utf8')) : {}
    const backupPath = `${placement.target}.bak-${Date.now()}`
    if (existsSync(dstAbs)) copyFileSync(dstAbs, join(plan.home, backupPath))
    const merged = deepMergeJson(base, patch, { key: '_devzero', value: plan.employeeId })
    atomicWrite(dstAbs, JSON.stringify(merged, null, 2))
    // 写后回读校验（S1 条款 2：底座容忍坏 JSON 静默半生效——自己写的不合法必须当场炸）
    JSON.parse(readFileSync(dstAbs, 'utf8'))
    return { target: placement.target, action: 'merge', backupPath }
  }
  // symlink（auth 凭证置备；无特权 fallback 只读拷贝）
  try {
    if (existsSync(dstAbs)) unlinkSync(dstAbs)
    mkdirSync(dirname(dstAbs), { recursive: true })
    symlinkSync(srcAbs, dstAbs, 'file')
    return { target: placement.target, action: 'symlink' }
  } catch {
    copyFileSync(srcAbs, dstAbs)
    return { target: placement.target, action: 'symlink' }
  }
}

/** 身份编译：AGENTS.md 原文 + 溯源注释首行（设计 §5.2；转换钩子位 adapters transforms 可扩展） */
function compileIdentity(source: string, plan: PlacementPlan): string {
  return `<!-- generated by devzero from ${plan.spec.id}@${plan.spec.version}/AGENTS.md; do not edit by hand -->\n${source}`
}

export function undoPlacement(home: string, outcome: ActionOutcome): void {
  const dstAbs = join(home, outcome.target)
  if (outcome.action === 'merge') {
    if (outcome.backupPath && existsSync(join(home, outcome.backupPath))) {
      if (existsSync(dstAbs)) unlinkSync(dstAbs)   // Windows：rename 到已存在目标会抛
      renameSync(join(home, outcome.backupPath), dstAbs)
    } else if (existsSync(dstAbs)) {
      unlinkSync(dstAbs)   // 本安装创建的 merge 目标：整删（S1 条款 4 创建 vs 合入区分）
    }
    return
  }
  if (existsSync(dstAbs)) {
    if (outcome.action === 'symlink') unlinkSync(dstAbs)
    else rmSync(dstAbs, { recursive: true, force: true })   // copy/convert：按产物本身删（skills 整目录 / 身份单文件），不株连同域其他产物
  }
}
