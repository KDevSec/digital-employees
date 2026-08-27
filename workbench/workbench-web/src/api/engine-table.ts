/**
 * 表快照契约类型（L5 看板线 T5；形态 = 协同编排设计 §6.1 node-table 的 TS 化）：
 * 看板「零硬编码」纪律的数据源——阶段/节点全部按表快照渲染，换表自动跟随。
 * 类型归 api 层（getTask 响应契约的一部分，见设计 §10-A），fixture 数据在
 * fixtures/demo-flow.table.ts（运行时动态 import 隔离，类型 import 擦除无耦合）。
 */

export interface TableSnapshotNode {
  id: string
  name: string
  kind: 'action' | 'gate' | 'terminal'
  /** 叙事分组（看板按阶段聚合渲染，可选；无 stage 节点归「未分组」） */
  stage?: string
  /** action 节点主责员工 id */
  emp?: string
  /** gate 节点引用的 gate_specs 键（1.0 原生「节点引用 gate_specs」分离式） */
  gate?: string
  /** 人工闸（进入即停靠 gate_paused） */
  human_gate?: boolean
  /** 阶段内置模型档位（发起页勾选「使用流程阶段内置档位」时生效） */
  model_tier?: string
  next: string[]
}

export interface GateSpec {
  kind: string
  reviewer: string
  on_pass: string
  on_reflow: string
  covers: string[]
}

export interface TableSnapshot {
  flow: string
  /** 表显示名（引擎 schema 可选——solo 动态表/无 display_name 的表缺省） */
  display_name?: string
  version: number
  max_retries: number
  terminal_fail: string
  delivery_node: string
  nodes: TableSnapshotNode[]
  gate_specs: Record<string, GateSpec>
}

/** 无 stage 节点的兜底分组名（terminal 节点常见） */
export const UNGROUPED_STAGE = '未分组'
