/**
 * install 服务编排（设计 §4.1：adapt() = negotiate + plan + execute 组合入口；API 层唯一依赖）。
 * home = <staffRoot>/<base>/<employee_id>（设计 §3.1）。
 */
import { join } from 'node:path'
import type { BaseAdapter, BaseId } from '../adapters/contract'
import { createCodebuddyAdapter } from '../adapters/codebuddy/index'
import { createClaudeCodeAdapter } from '../adapters/claude-code/index'
import { createQoderAdapter } from '../adapters/qoder/index'
import { executeInstall, type ExecuteOutput } from './executor/execute'
import type { ProbeResult } from './negotiate'
import { writeReport, type InstallReport } from './report'
import { createDeploymentRegistry } from './registry/registry'
import type { EmployeeSpec } from './spec/types'

export interface InstallServiceDeps {
  registryFile: string
  staffRoot: string
  authSourceDirs: Record<BaseId, string>
  probe: (base: BaseId) => ProbeResult
}

const ADAPTERS: Record<BaseId, () => BaseAdapter> = {
  'claude-code': createClaudeCodeAdapter,
  codebuddy: createCodebuddyAdapter,
  qoder: createQoderAdapter,
}

export function installEmployee(deps: InstallServiceDeps, input: { spec: EmployeeSpec; packageRoot: string; base: BaseId }): InstallReport {
  const started = new Date().toISOString()
  const adapter = ADAPTERS[input.base]()
  const home = join(deps.staffRoot, input.base, input.spec.id)
  const registry = createDeploymentRegistry(deps.registryFile)
  const probeResult = deps.probe(input.base)

  const out: ExecuteOutput = executeInstall({
    spec: input.spec, adapter, packageRoot: input.packageRoot,
    registry, registryFile: deps.registryFile,
    home, baseVersion: probeResult.version ?? '0.0.0', probe: probeResult,
    authSourceDir: deps.authSourceDirs[input.base],
  })

  const report: InstallReport = {
    report_version: 1,
    employee_id: input.spec.id, package_version: input.spec.version,
    base: input.base, base_version: probeResult.version ?? '', base_version_tested: adapter.profile.version_tested,
    scope: { type: 'deployment', home },
    negotiation: out.negotiation,
    placements: [],
    result: out.result,
    started_at: started, finished_at: new Date().toISOString(),
  }
  if (out.error) {
    report.error = { code: out.error.code, message: out.error.message, phase: out.error.phase, recoverable: out.error.recoverable, hint: out.error.hint }
  }
  // placements 回填：与 executeInstall 内部 plan 同入参（含 authSourceDir）——视图与执行一致，
  // 否则 env-token 降级（plan.ts 依据 authSourceDir 判定跳过）会因重算走另一条路，
  // 导致「看到的落位 ≠ 实际干的活」（I2 P0d 评审发现）。
  const plan = adapter.plan(input.spec, { home, authSourceDir: deps.authSourceDirs[input.base] })
  report.placements = plan.placements.map((p) => ({ source: p.source, target: p.target, action: p.action, conflict: null }))

  if (out.result !== 'failed') writeReport(home, report)   // failed（negotiate blocked）不建 home，报告仅返回不落盘
  return report
}
