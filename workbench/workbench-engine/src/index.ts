/**
 * @devzero/engine 入口（I0-5 T5 空壳骨架）。
 * L3 编排引擎线在此实现：R1 状态机 / R2 节点图+guard / R3 gate（含 reflow）/
 * events 账本 / node-table 加载——契约见需求路线图 §3.3（契约四件套），
 * 由 .worktrees/l3-engine 线按冻结契约填充，本包不含任何逻辑。
 */

/** 引擎包版本（随 L3 线首次实质交付起语义化） */
export const ENGINE_VERSION = '0.0.1'
