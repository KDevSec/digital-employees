/** Claude Code adapter（S4 V1/V6 实证链；plan 落位 = common/plan 共享骨架，差异全在 profile） */
import type { BaseAdapter } from '../contract'
import { buildPlan } from '../common/plan'
import { buildLaunchSpec } from '../common/launch'
import { listModelsFor, unwrapListModels } from '../common/models'
import type { CmdRunner } from '../../bases/probe'
import { profile } from './profile'

export function createClaudeCodeAdapter(): BaseAdapter {
  return {
    profile,
    plan(spec, opts) { return buildPlan(profile, spec, opts) },
    async launch(input) { return await buildLaunchSpec(profile, input) },
    async listModels(run?: CmdRunner) {
      return unwrapListModels(await listModelsFor(profile.id, run))
    },
  }
}
