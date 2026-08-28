/**
 * 落位动作原语（设计 §6.1 ⑤；S1 §8 条款 2/3）：
 * - copy/convert：单文件先写临时文件再原子 rename（Windows：目标存在先 unlink）；
 *   copy 目标可为目录（skills 包体）→ 递归拷贝；
 * - merge：写前备份 → 程序化深合并（禁文本拼接）→ 本员工条目附 _devzero 标记；
 *   写后回读校验——自己写出的不合法 JSON 必须当场炸（底座容忍坏 JSON 静默半生效）；
 * - symlink：无特权 fallback 只读拷贝（P-12 软链优于拷贝，Windows 兼容降级）；
 * - 虚拟源（source 以 __ 开头，plan 骨架产出）：__mcp__ 从 spec.connectors 内存物化 merge 补丁、
 *   __auth__/<f> 从 plan.authSourceDir 取源——源缺失抛 INSTALL_AUTH_SOURCE_MISSING（一等错误）。
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { convertInstructions } from '../../adapters/common/plan'
import type { Placement, PlacementAction, PlacementPlan } from '../../adapters/contract'
import { InstallError } from '../errors'
import type { EmployeeSpec } from '../spec/types'

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
  const dstAbs = join(plan.home, placement.target)

  // 虚拟源物化（Task 6；设计 §5）：不落包内文件——
  // __mcp__ 从 plan.spec.connectors 内存生成 merge 补丁；__auth__/<f> 从 plan.authSourceDir 取源。
  if (placement.source === '__mcp__') {
    return mergePlacement(plan, placement, dstAbs, mcpPatch(plan.spec))
  }
  if (placement.source.startsWith('__auth__/')) {
    return authPlacement(plan, placement, dstAbs)
  }

  const srcAbs = join(packageRoot, placement.source)
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
      content = convertInstructions(content.toString(), plan.spec)
    }
    atomicWrite(dstAbs, content)
    return { target: placement.target, action: placement.action }
  }
  if (placement.action === 'merge') {
    return mergePlacement(plan, placement, dstAbs, JSON.parse(readFileSync(srcAbs, 'utf8')))
  }
  return symlinkPlacement(placement, dstAbs, srcAbs)
}

/** __mcp__ 虚拟源物化：spec.connectors → { mcpServers } merge 补丁（内存生成，无临时文件） */
function mcpPatch(spec: EmployeeSpec): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {}
  for (const conn of spec.connectors) {
    mcpServers[conn.name] = conn.type === 'http'
      ? { type: 'http', url: conn.url }
      : { command: conn.command, args: conn.args, env: conn.env }
  }
  return { mcpServers }
}

/** __auth__/<f> 虚拟源物化：凭证源 = plan.authSourceDir/<f>（各底座全局配置目录）。
 *  env-token 认证形态（设计 §5.1）由 plan 层在生成 placements 时完成降级（跳过落位），
 *  本函数仅处理「plan 决定落位但源文件缺失」的阻塞路径（双缺或源不全）。 */
function authPlacement(plan: PlacementPlan, placement: Placement, dstAbs: string): ActionOutcome {
  const file = placement.source.slice('__auth__/'.length)
  const missing = (): InstallError => new InstallError({
    code: 'INSTALL_AUTH_SOURCE_MISSING',
    message: plan.authSourceDir
      ? `底座凭证源文件缺失：${join(plan.authSourceDir, file)}`
      : `底座凭证源目录未提供（authSourceDir 缺失），无法置备：${file}`,
    phase: 'execute',
    recoverable: true,
    hint: '请先在该底座 CLI 登录后重试安装',
  })
  if (!plan.authSourceDir) throw missing()
  const srcAbs = join(plan.authSourceDir, file)
  if (!existsSync(srcAbs)) throw missing()
  return symlinkPlacement(placement, dstAbs, srcAbs)
}

/** merge 落位（hooks/settings/.mcp.json 共用）：备份 → 深合并带 _devzero 标记 → 原子写 → 回读校验 */
function mergePlacement(plan: PlacementPlan, placement: Placement, dstAbs: string, patch: unknown): ActionOutcome {
  const base = existsSync(dstAbs) ? JSON.parse(readFileSync(dstAbs, 'utf8')) : {}
  const backupPath = `${placement.target}.bak-${Date.now()}`
  if (existsSync(dstAbs)) copyFileSync(dstAbs, join(plan.home, backupPath))
  const merged = deepMergeJson(base, patch, { key: '_devzero', value: plan.employeeId })
  atomicWrite(dstAbs, JSON.stringify(merged, null, 2))
  // 写后回读校验（S1 条款 2：底座容忍坏 JSON 静默半生效——自己写的不合法必须当场炸）
  JSON.parse(readFileSync(dstAbs, 'utf8'))
  return { target: placement.target, action: 'merge', backupPath }
}

/** symlink 落位（auth 凭证置备；无特权 fallback 只读拷贝——P-12 软链优于拷贝，Windows 兼容降级） */
function symlinkPlacement(placement: Placement, dstAbs: string, srcAbs: string): ActionOutcome {
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
