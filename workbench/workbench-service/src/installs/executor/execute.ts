/**
 * 安装主流程（设计 §6.1 全序；设计的 adapt() 语义 = negotiate + plan + execute 组合，本函数即 execute 段）：
 * ① negotiate（blocked → failed，不建域）→ ② 幂等预检（manifest 完整 → unchanged）
 * → ③ registry 行 installing + 事务日志 → ④ 逐项 runPlacement（失败逆序 undoPlacement）
 * → ⑤ manifest + registry installed → ⑥ 失败 → 回滚 + registry broken + 结构化错误。
 * 崩溃恢复（设计 §6.4）：recoverInterrupted 扫描非终态行——域完整补转 installed，不完整标 broken。
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseAdapter } from '../../adapters/contract'
import { InstallError } from '../errors'
import { buildManifest, manifestPath, verifyManifest, type InstallManifest } from '../manifest'
import { negotiate, type NegotiationResult, type ProbeResult } from '../negotiate'
import type { DeploymentRegistry } from '../registry/registry'
import type { EmployeeSpec } from '../spec/types'
import { runPlacement, undoPlacement, type ActionOutcome } from './actions'
import { clearTransaction, writeTransaction } from './transaction'

export interface ExecuteInput {
  spec: EmployeeSpec; adapter: BaseAdapter; packageRoot: string
  registry: DeploymentRegistry; registryFile: string
  home: string; baseVersion: string; probe: ProbeResult
}

export interface ExecuteOutput {
  result: 'success' | 'unchanged' | 'rolled-back' | 'failed'
  negotiation: NegotiationResult
  manifest: InstallManifest | null
  error: InstallError | null
}

export function executeInstall(input: ExecuteInput): ExecuteOutput {
  const { spec, adapter, registry, home } = input
  const negotiation = negotiate(spec, adapter.profile, input.probe)

  const fail = (err: InstallError): ExecuteOutput => ({ result: 'failed', negotiation, manifest: null, error: err })

  if (negotiation.blocked) {
    return fail(new InstallError({
      code: negotiation.blocked.code, message: negotiation.blocked.message,
      phase: 'negotiate', recoverable: false, hint: negotiation.blocked.hint,
    }))
  }

  // 幂等预检：installed 且 manifest 校验零漂移 → unchanged
  const existing = registry.find(adapter.profile.id, spec.id)
  if (existing?.status === 'installed' && existsSync(manifestPath(home))) {
    const manifest = JSON.parse(readFileSync(manifestPath(home), 'utf8')) as InstallManifest
    if (manifest.spec_version === spec.version && verifyManifest(home, manifest).length === 0) {
      return { result: 'unchanged', negotiation, manifest, error: null }
    }
  }

  const plan = adapter.plan(spec, { home })

  // 崩溃残留自愈前置（设计 §6.4 双消费方之二）：同目标 broken 先重置
  mkdirSync(join(home, 'config'), { recursive: true })
  mkdirSync(join(home, 'memory'), { recursive: true })
  mkdirSync(join(home, 'sessions'), { recursive: true })

  registry.upsert({
    employee_id: spec.id, spec_version: spec.version, base: adapter.profile.id,
    home, status: 'installing',
    identity_anchor: adapter.profile.identity_anchor, base_version: input.baseVersion,
    installed_at: new Date().toISOString(), last_launch_at: null,
    manifest_path: manifestPath(home),
  })

  const startedAt = new Date().toISOString()
  const done: ActionOutcome[] = []
  writeTransaction(home, { started_at: startedAt, phase: 'executing', plan, done: [] })

  for (const placement of plan.placements) {
    try {
      done.push(runPlacement(plan, placement, input.packageRoot))
      writeTransaction(home, { started_at: startedAt, phase: 'executing', plan, done })
    } catch (e) {
      // 逆序回滚（S1 §8 条款 1：单事务）
      for (let i = done.length - 1; i >= 0; i--) undoPlacement(home, done[i])
      // 回滚收尾：清掉回滚后变空的 config/ 域目录（rmdir 只删空目录——非空即抛，防误删产物）
      try { rmdirSync(join(home, 'config')) } catch { /* 非空或不存在：保留 */ }
      clearTransaction(home)
      registry.upsert({
        employee_id: spec.id, spec_version: spec.version, base: adapter.profile.id,
        home, status: 'broken',
        identity_anchor: adapter.profile.identity_anchor, base_version: input.baseVersion,
        installed_at: new Date().toISOString(), last_launch_at: null,
        manifest_path: manifestPath(home),
      })
      const err = e instanceof InstallError ? e : new InstallError({
        code: 'INSTALL_EXECUTE_FAILED', message: String(e), phase: 'execute', recoverable: true, hint: '重跑安装可自愈（幂等）',
      })
      return { result: 'rolled-back', negotiation, manifest: null, error: err }
    }
  }

  const manifest = buildManifest({ spec, base: adapter.profile.id, home })
  writeFileSync(manifestPath(home), JSON.stringify(manifest, null, 2), 'utf8')

  registry.upsert({
    employee_id: spec.id, spec_version: spec.version, base: adapter.profile.id,
    home, status: 'installed',
    identity_anchor: adapter.profile.identity_anchor, base_version: input.baseVersion,
    installed_at: new Date().toISOString(), last_launch_at: null,
    manifest_path: manifestPath(home),
  })
  clearTransaction(home)
  return { result: 'success', negotiation, manifest, error: null }
}

export function recoverInterrupted(registry: DeploymentRegistry): { recovered: string[]; broken: string[] } {
  const recovered: string[] = []
  const broken: string[] = []
  for (const rec of registry.list()) {
    if (rec.status !== 'installing' && rec.status !== 'upgrading') continue
    const manifest = existsSync(manifestPath(rec.home))
      ? JSON.parse(readFileSync(manifestPath(rec.home), 'utf8')) as InstallManifest
      : null
    if (manifest && verifyManifest(rec.home, manifest).length === 0) {
      registry.upsert({ ...rec, status: 'installed' })
      recovered.push(`${rec.base}:${rec.employee_id}`)
    } else {
      registry.upsert({ ...rec, status: 'broken' })
      broken.push(`${rec.base}:${rec.employee_id}`)
    }
  }
  return { recovered, broken }
}
