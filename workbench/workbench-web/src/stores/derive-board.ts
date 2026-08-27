/**
 * 派生层（L5 看板线 T5，设计 §5.2）：表快照 + 任务状态 → 阶段/节点渲染视图模型。
 * 零硬编码纪律①的落点——stage/name/kind 全来自表快照，换表自动跟随（验收锚 K6/K7）；
 * 组件层只消费 BoardViewModel，不感知事件流与表结构。
 */
import { UNGROUPED_STAGE, type TableSnapshot } from '../api/engine-table'
import type { ActiveDispatch, TaskState } from './kanban'

export type NodeState = 'pending' | 'active' | 'done' | 'paused'

export interface NodeView {
  id: string
  name: string
  kind: 'action' | 'gate' | 'terminal'
  state: NodeState
  /** 人工闸标记（表 human_gate；停靠高亮与 ⚖ 徽记的渲染依据） */
  humanGate: boolean
  /** 该节点上活跃的派发（员工卡数据；同节点多派发取首个） */
  activeDispatch: ActiveDispatch | null
}

export interface StageView {
  name: string
  nodes: NodeView[]
}

export interface BoardViewModel {
  /** 阶段序 = 表内首次出现序；无 stage 节点归未分组（自然落尾部） */
  stages: StageView[]
}

export function deriveBoard(table: TableSnapshot, task: TaskState): BoardViewModel {
  const stages = new Map<string, NodeView[]>()
  for (const node of table.nodes) {
    const state: NodeState = task.doneNodes.includes(node.id)
      ? 'done'
      : node.id === task.currentNode
        ? task.status === 'gate_paused'
          ? 'paused'
          : 'active'
        : 'pending'
    const activeDispatch = task.activeDispatches.find((d) => d.node === node.id) ?? null
    const view: NodeView = {
      id: node.id,
      name: node.name,
      kind: node.kind,
      state,
      humanGate: node.human_gate === true,
      activeDispatch,
    }
    const key = node.stage ?? UNGROUPED_STAGE
    if (!stages.has(key)) stages.set(key, [])
    stages.get(key)!.push(view)
  }
  return { stages: [...stages.entries()].map(([name, nodes]) => ({ name, nodes })) }
}
