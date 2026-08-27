/** CodeBuddy adapter（CC 同构预期；身份面 429 待复验——设计 §5.1 ⏳ / M2 清单 3） */
import type { BaseAdapter } from '../contract'
import { buildPlan } from '../common/plan'
import { buildLaunchSpec } from '../common/launch'
import { profile } from './profile'

export function createCodebuddyAdapter(): BaseAdapter {
  return {
    profile,
    plan(spec, opts) { return buildPlan(profile, spec, opts) },
    async launch(input) { return await buildLaunchSpec(profile, input) },
    async listModels() { throw new Error('NOT_IMPLEMENTED: Task 9') },
  }
}
