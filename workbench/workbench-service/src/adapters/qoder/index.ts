/** Qoder adapter（config-domain 主路径 D-L2-01；project-file 回退档改档案值即可，零代码） */
import type { BaseAdapter } from '../contract'
import { buildPlan } from '../common/plan'
import { buildLaunchSpec } from '../common/launch'
import { profile } from './profile'

export function createQoderAdapter(): BaseAdapter {
  return {
    profile,
    plan(spec, opts) { return buildPlan(profile, spec, opts) },
    async launch(input) { return await buildLaunchSpec(profile, input) },
    async listModels() { throw new Error('NOT_IMPLEMENTED: Task 9') },
  }
}
