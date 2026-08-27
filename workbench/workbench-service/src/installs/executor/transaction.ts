/**
 * 事务日志（设计 §6.1 ④；崩溃恢复依据 = registry 非终态行 + 域完整性判定，设计 §6.4 裁决）。
 * 结构：<home>/.transaction/current.json —— { started_at, phase, plan, done }。
 * 恢复判定不消费本日志（走 registry 状态 + manifest 完整性）；done 记录供人工诊断，导出面保留。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlacementPlan } from '../../adapters/contract'
import type { ActionOutcome } from './actions'

export interface TransactionState {
  started_at: string
  phase: 'prepared' | 'executing' | 'committing' | 'done'
  plan: PlacementPlan
  done: ActionOutcome[]
}

export function txPath(home: string): string { return join(home, '.transaction', 'current.json') }

export function writeTransaction(home: string, state: TransactionState): void {
  mkdirSync(join(home, '.transaction'), { recursive: true })
  writeFileSync(txPath(home), JSON.stringify(state, null, 2), 'utf8')
}

export function readTransaction(home: string): TransactionState | null {
  if (!existsSync(txPath(home))) return null
  return JSON.parse(readFileSync(txPath(home), 'utf8')) as TransactionState
}

export function clearTransaction(home: string): void {
  const dir = join(home, '.transaction')
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
