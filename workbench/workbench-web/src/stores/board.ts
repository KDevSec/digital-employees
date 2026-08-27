/**
 * 泳道任务列表层状态（T4，1.0 协同编排形态·抄形不抄管线）：
 * laneOf = 引擎任务 → 五列泳道的纯派生（任务状态 + 推进度，零硬编码）；
 * 需求池草稿 = 页面本地态（不进引擎——拖入待办池才 createTask 发起编排；
 * 派单失败留池可重拖，1.0 语义）。数据通道 = 2.0 契约（SSE + hydrate 重放）。
 */
import { defineStore } from 'pinia'
import type { TaskState } from './kanban'

/** 五列泳道（1.0 色系：蓝/紫/琥珀/红/绿；后三列派生不可拖） */
export type LaneId = 'pool' | 'plan' | 'exec' | 'decide' | 'done'

export interface LaneDef {
  id: LaneId
  name: string
  /** 列头彩点色 token（tokens.css 既有色系） */
  dot: string
}

export const LANES: LaneDef[] = [
  { id: 'pool', name: '需求池', dot: 'blue' },
  { id: 'plan', name: '待办池', dot: 'violet' },
  { id: 'exec', name: '协同执行', dot: 'amber' },
  { id: 'decide', name: '待人工决策', dot: 'red' },
  { id: 'done', name: '已交付', dot: 'green' },
]

/** 引擎任务 → 泳道列（纯函数）：
 *  done（completed|aborted）→ 已交付；decide（gate_paused|blocked）→ 待人工决策；
 *  in_progress 按推进度二分——未离开过节点=待办池（刚发起），有推进=协同执行 */
export function laneOf(task: TaskState): LaneId {
  if (task.status === 'completed' || task.status === 'aborted') return 'done'
  if (task.status === 'gate_paused' || task.status === 'blocked') return 'decide'
  return task.doneNodes.length > 0 ? 'exec' : 'plan'
}

/** 需求池草稿（本地态：不进引擎；error 非空 = 上次派单失败，留池重拖重试） */
export interface NeedDraft {
  id: string
  title: string
  input: string
  workspace: string
  flow?: string
  base?: string
  error?: string
}

let needSeq = 0

export const useBoardStore = defineStore('board', {
  state: () => ({ needs: [] as NeedDraft[] }),
  actions: {
    addNeed(need: Omit<NeedDraft, 'id'> & { id?: string }): void {
      this.needs = [...this.needs, { ...need, id: need.id ?? `need-${++needSeq}` }]
    },
    removeNeed(id: string): void {
      this.needs = this.needs.filter((n) => n.id !== id)
    },
    markNeedError(id: string, error: string): void {
      this.needs = this.needs.map((n) => (n.id === id ? { ...n, error } : n))
    },
  },
})
