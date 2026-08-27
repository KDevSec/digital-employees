/** 安装报告（设计 §7：上游 §4.3 为基线的裁剪版——signature 裁剪、scope 改 deployment、conflict 枚举重定义） */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseId, PlacementAction } from '../adapters/contract'
import type { NegotiationResult } from './negotiate'

export interface InstallReport {
  report_version: 1
  employee_id: string; package_version: string
  base: BaseId; base_version: string; base_version_tested: string
  scope: { type: 'deployment'; home: string }
  negotiation: NegotiationResult
  placements: { source: string; target: string; action: PlacementAction; conflict: null }[]
  result: 'success' | 'unchanged' | 'rolled-back' | 'failed'
  error?: { code: string; message: string; phase: string; recoverable: boolean; hint: string }
  started_at: string; finished_at: string
}

export function writeReport(home: string, report: InstallReport): string {
  const dir = join(home, 'reports')
  mkdirSync(dir, { recursive: true })
  // 时间戳中 : 与 . 均为 Windows 文件名非法/风险字符，统一替换为 -
  const file = join(dir, `install-${report.finished_at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
  return file
}

export function listReports(home: string): InstallReport[] {
  const dir = join(home, 'reports')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith('install-') && f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as InstallReport)
}
