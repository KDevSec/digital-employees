/** Claude Code adapter（S4 V1/V6 实证链；plan 落位 = common/plan 共享骨架，差异全在 profile） */
import type { BaseAdapter } from '../contract'
import { buildPlan } from '../common/plan'
import { buildLaunchSpec } from '../common/launch'
import { profile } from './profile'

export function createClaudeCodeAdapter(): BaseAdapter {
  return {
    profile,
    plan(spec, opts) { return buildPlan(profile, spec, opts) },
    async launch(input) { return await buildLaunchSpec(profile, input) },
    async listModels() { throw new Error('NOT_IMPLEMENTED: Task 9') },
  }
}
