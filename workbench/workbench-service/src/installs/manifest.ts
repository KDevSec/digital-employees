/**
 * .devzero-manifest.json：版本 + 产物文件清单 + sha256（升级=重跑 adapt / 漂移=对 hash / 卸载=按清单删）。
 * 收录范围 = config/ 域内产物 + home 顶层凭证；**memory/ sessions/ reports/ .transaction/ 豁免**（用户资产）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BaseId } from '../adapters/contract'
import type { EmployeeSpec } from './spec/types'

export interface ManifestFile { path: string; sha256: string }
export interface InstallManifest {
  manifest_version: 1
  employee_id: string; spec_version: string; base: BaseId
  files: ManifestFile[]            // 相对 home 的产物路径（config/ 域内 + 顶层凭证等）
}
export interface DriftItem { path: string; kind: 'missing' | 'hash-mismatch' | 'extra' }

const MANIFEST_NAME = '.devzero-manifest.json'

export function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

/** 递归收集 root 下全部文件（abs 路径）。walk 只从 config/ 根起——豁免目录（memory/sessions/reports/.transaction）天然不在范围 */
function walkFiles(root: string, acc: string[] = []): string[] {
  if (!existsSync(root)) return acc
  for (const name of readdirSync(root)) {
    const abs = join(root, name)
    if (statSync(abs).isDirectory()) walkFiles(abs, acc)
    else acc.push(abs)
  }
  return acc
}

export function buildManifest(input: { spec: EmployeeSpec; base: BaseId; home: string }): InstallManifest {
  const { home } = input
  const files: ManifestFile[] = []
  // 产物根 = config/（全部 adapt 落位都在域内；顶层凭证若存在也收录）
  const roots = [join(home, 'config')]
  for (const root of roots) {
    for (const abs of walkFiles(root)) {
      const rel = relative(home, abs).split('\\').join('/')
      files.push({ path: rel, sha256: sha256File(abs) })
    }
  }
  return { manifest_version: 1, employee_id: input.spec.id, spec_version: input.spec.version, base: input.base, files }
}

export function verifyManifest(home: string, manifest: InstallManifest): DriftItem[] {
  const drift: DriftItem[] = []
  for (const f of manifest.files) {
    const abs = join(home, f.path)
    try {
      if (sha256File(abs) !== f.sha256) drift.push({ path: f.path, kind: 'hash-mismatch' })
    } catch {
      drift.push({ path: f.path, kind: 'missing' })
    }
  }
  const known = new Set(manifest.files.map((f) => f.path))
  for (const abs of walkFiles(join(home, 'config'))) {
    const rel = relative(home, abs).split('\\').join('/')
    if (!known.has(rel)) drift.push({ path: rel, kind: 'extra' })
  }
  return drift
}

export function manifestPath(home: string): string { return join(home, MANIFEST_NAME) }
