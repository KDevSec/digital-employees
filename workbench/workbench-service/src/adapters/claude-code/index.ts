/**
 * Claude Code adapter（最小版——Task 5 为 executor 测试先行建立）：
 * plan() 内联三类落位（身份 convert / skills copy / hooks merge），不走 common/plan.ts——
 * Task 6 建共享 plan 骨架时重构（补 auth symlink / connectors merge / project-file 回退档 / 虚拟源）。
 * launch/listModels 分别由 Task 8/9 实装。
 */
import type { BaseAdapter, Placement, PlacementPlan } from '../contract'
import { profile } from './profile'
import type { EmployeeSpec } from '../../installs/spec/types'

export function createClaudeCodeAdapter(): BaseAdapter {
  return {
    profile,
    plan(spec: EmployeeSpec, opts: { home: string }): PlacementPlan {
      const placements: Placement[] = []
      placements.push({ source: 'AGENTS.md', target: `config/${profile.identity_file}`, action: 'convert' })
      for (const skill of spec.skills) {
        placements.push({
          source: `skills/${skill.name}`,
          target: `config/${profile.skills_dir}/${skill.name}`,
          action: 'copy',
        })
      }
      if (spec.hooksFile) {
        placements.push({ source: spec.hooksFile, target: 'config/settings.json', action: 'merge' })
      }
      return { base: profile.id, home: opts.home, employeeId: spec.id, spec, placements }
    },
    async launch() { throw new Error('NOT_IMPLEMENTED: Task 8') },
    async listModels() { throw new Error('NOT_IMPLEMENTED: Task 9') },
  }
}
