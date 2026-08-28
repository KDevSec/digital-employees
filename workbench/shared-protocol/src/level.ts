// 员工能力层级推导（基于 usage_modes 包含性归档）
// ─ +编排 → L2（编排引擎能力，最高级）
// ─ +方法论 或 +流程 → L1（指导层能力）
// ─ 否则 L0（裸用即可）

export type Level = 'L0' | 'L1' | 'L2'

export function deriveLevel(usage_modes: readonly string[]): Level {
  if (usage_modes.includes('+编排')) return 'L2'
  if (usage_modes.includes('+方法论') || usage_modes.includes('+流程')) return 'L1'
  return 'L0'
}
