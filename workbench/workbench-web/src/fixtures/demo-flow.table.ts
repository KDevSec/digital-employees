/**
 * demo-flow 表快照 fixture（L5 看板线 T2，设计 §6.1）：
 * 协同编排设计 §6.1 demo-flow 十二节点表的数据形态——类型契约（TableSnapshot）在
 * src/api/engine-table.ts（getTask 响应契约的一部分），本文件只持数据。
 * 看板「零硬编码」纪律的数据源——阶段/节点全部按表渲染，换表自动跟随。
 * 真源 = 引擎线快照文件（联调后由 getTask 下发真表，本文件为 fixture 先行口径）。
 */
import type { TableSnapshot } from '../api/engine-table'

export type { TableSnapshot, TableSnapshotNode, GateSpec } from '../api/engine-table'

/** demo-flow（§6.1 原样：五阶段 12 节点，demo 表默认全关人工闸） */
export const demoFlowTable: TableSnapshot = {
  flow: 'demo-flow',
  display_name: '五阶段演示交付',
  version: 1,
  max_retries: 6,
  terminal_fail: 'n-fail',
  delivery_node: 'n-done',
  nodes: [
    { id: 'n-adm', name: '准入', kind: 'action', stage: '准入', emp: 'sec-compliance', model_tier: '评审安全档', next: ['n0-req'] },
    { id: 'n0-req', name: '需求核验', kind: 'action', stage: '需求核验', emp: 'req-clarifier', next: ['g-req-review'] },
    { id: 'g-req-review', name: '需求评审', kind: 'gate', stage: '需求核验', gate: 'g-req-review', next: ['n1-design', 'n0-req'] },
    { id: 'n1-design', name: '设计核验', kind: 'action', stage: '设计核验', emp: 'sys-engineer', model_tier: '设计档', next: ['g-design-review'] },
    { id: 'g-design-review', name: '设计评审', kind: 'gate', stage: '设计核验', gate: 'g-design-review', next: ['g-sec-design', 'n1-design'] },
    { id: 'g-sec-design', name: '安全设计审核', kind: 'gate', stage: '设计核验', gate: 'g-sec-design', next: ['n2-impl', 'n1-design'] },
    { id: 'n2-impl', name: '开发实现', kind: 'action', stage: '开发实现', emp: 'dev-engineer', model_tier: '编码档', next: ['g-code-review'] },
    { id: 'g-code-review', name: '代码评审', kind: 'gate', stage: '开发实现', gate: 'g-code-review', next: ['g-sec-code', 'n2-impl'] },
    { id: 'g-sec-code', name: '代码安全审核', kind: 'gate', stage: '开发实现', gate: 'g-sec-code', next: ['n3-sec', 'n2-impl'] },
    { id: 'n3-sec', name: '准出', kind: 'action', stage: '准出', emp: 'sec-compliance', model_tier: '评审安全档', next: ['n-done'] },
    { id: 'n-done', name: '交付清点', kind: 'terminal', next: [] },
    { id: 'n-fail', name: '终止', kind: 'terminal', next: [] },
  ],
  gate_specs: {
    'g-req-review': { kind: 'review', reviewer: 'reviewer-expert', on_pass: 'n1-design', on_reflow: 'n0-req', covers: ['n0-req'] },
    'g-design-review': { kind: 'review', reviewer: 'reviewer-expert', on_pass: 'g-sec-design', on_reflow: 'n1-design', covers: ['n1-design'] },
    'g-sec-design': { kind: 'review', reviewer: 'sec-design', on_pass: 'n2-impl', on_reflow: 'n1-design', covers: ['n1-design'] },
    'g-code-review': { kind: 'review', reviewer: 'reviewer-expert', on_pass: 'g-sec-code', on_reflow: 'n2-impl', covers: ['n2-impl'] },
    'g-sec-code': { kind: 'review', reviewer: 'sec-code', on_pass: 'n3-sec', on_reflow: 'n2-impl', covers: ['n2-impl'] },
  },
}

/** gate-pause 剧本变体表：仅 n0-req 开人工闸（兼验证换表跟随——零硬编码纪律①） */
export const demoFlowGatePauseTable: TableSnapshot = {
  ...demoFlowTable,
  nodes: demoFlowTable.nodes.map((n) => (n.id === 'n0-req' ? { ...n, human_gate: true } : n)),
}

/** 七员工 display 映射（D-044 花名册；display 来源契约歧义 B 的 fixture 口径） */
export const employees: Record<string, string> = {
  'req-clarifier': '需求澄清师',
  'sys-engineer': '系统工程师',
  'dev-engineer': '开发工程师',
  'reviewer-expert': '评审专家',
  'sec-compliance': '安全合规审核员',
  'sec-design': '安全设计审核员',
  'sec-code': '代码安全审核员',
}
