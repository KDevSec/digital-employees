/**
 * 看板归并 store（L5 看板线 T4，设计 §5.1）：
 * applyEvent 纯函数 = 事件流 → 看板状态的唯一映射点（D-kb02）——四剧本重放测试即行为规格；
 * pinia 壳（useKanbanStore）接线 SSE 消费层（connect/disconnect），组件只读不写。
 *
 * 归并纪律（对齐设计 §8 看板消费契约）：
 * - 混流分拣：事件自带 task_id，未知任务的事件建最小占位卡（SSE 全量订阅的兜底语义）；
 * - 错误常驻卡面：dispatch done status=error / run.aborted reason 记入 blockedReason（纪律⑥，非 toast）；
 * - 人工 confirm 也进流水：gate 事件不区分人工/AI，actor 原样保留（纪律④）；
 * - feed 全局流水滚动窗口 cap（FEED_CAP），防长任务撑爆内存。
 */
import { defineStore } from 'pinia'

import type { Connection, EngineStream } from '../api/engine-stream'
import type { EngineEvent } from '../api/engine-events'

export type TaskStatus = 'in_progress' | 'gate_paused' | 'blocked' | 'completed' | 'aborted'

/** 活跃派发（dispatch start→done 之间的员工卡） */
export interface ActiveDispatch {
  dispatchId: string
  emp: string
  node: string | null
  sinceSeq: number
}

/** 评审流水条目（gate 事件归并形态；人工 confirm 同形态进流水） */
export interface GateRecord {
  gate: string
  kind: string
  node: string
  verdict: string
  iter: number
  reviewer: string
  actor: string
  issues?: string[]
  ts: string
}

export interface TaskState {
  taskId: string
  title: string
  flow: string
  displayName: string
  workspace: string
  status: TaskStatus
  currentNode: string | null
  /** 到过且已离开的节点（transition from；reflow 目标会移除） */
  doneNodes: string[]
  activeDispatches: ActiveDispatch[]
  gateRecords: GateRecord[]
  /** 常驻错误（dispatch error / abort reason）——错误常驻卡面纪律 */
  blockedReason: string | null
  durationS: number | null
  lastSeq: number
  createdAt: string
  updatedAt: string
}

export interface KanbanState {
  connection: Connection
  tasks: Record<string, TaskState>
  /** 全局事件流水（滚动窗口，最新在后） */
  feed: EngineEvent[]
}

/** 全局流水滚动窗口上限 */
export const FEED_CAP = 200

export function emptyKanbanState(): KanbanState {
  return { connection: 'connecting', tasks: {}, feed: [] }
}

/** 未知任务的占位卡（混流兜底：run.created 未到先来了后续事件） */
function placeholderTask(taskId: string, seq: number, ts: string): TaskState {
  return {
    taskId,
    title: taskId,
    flow: '',
    displayName: '',
    workspace: '',
    status: 'in_progress',
    currentNode: null,
    doneNodes: [],
    activeDispatches: [],
    gateRecords: [],
    blockedReason: null,
    durationS: null,
    lastSeq: seq,
    createdAt: ts,
    updatedAt: ts,
  }
}

/** transition.status 快照 → 任务状态（认识四值覆盖，未知值不动——保守归并） */
function statusFromSnapshot(status: string): TaskStatus | null {
  switch (status) {
    case 'in_progress':
    case 'gate_paused':
    case 'blocked':
    case 'completed':
      return status
    default:
      return null
  }
}

/**
 * 单事件归并（不可变更新）。纯函数——测试直接以剧本序列 reduce 调用。
 */
export function applyEvent(state: KanbanState, ev: EngineEvent): KanbanState {
  const tasks = { ...state.tasks }
  const prev: TaskState = tasks[ev.task_id] ?? placeholderTask(ev.task_id, ev.seq, ev.ts)
  let task: TaskState

  switch (ev.type) {
    case 'run.created':
      task = {
        ...prev,
        title: ev.title,
        flow: ev.flow,
        displayName: ev.display_name,
        workspace: ev.workspace,
        status: 'in_progress',
      }
      break
    case 'dispatch':
      if (ev.phase === 'start') {
        task = {
          ...prev,
          activeDispatches: [
            ...prev.activeDispatches,
            { dispatchId: ev.dispatch_id, emp: ev.emp, node: ev.node ?? null, sinceSeq: ev.seq },
          ],
        }
      } else {
        const rest = prev.activeDispatches.filter((d) => d.dispatchId !== ev.dispatch_id)
        task = {
          ...prev,
          activeDispatches: rest,
          blockedReason:
            ev.status === 'error'
              ? (prev.blockedReason ?? `派发失败：${ev.emp}${ev.node ? `（${ev.node}）` : ''}`)
              : prev.blockedReason,
        }
      }
      break
    case 'transition': {
      const doneNodes = [...prev.doneNodes]
      if (ev.from && !doneNodes.includes(ev.from)) doneNodes.push(ev.from)
      if (ev.reflow) {
        // 回流：目标节点重新活跃，从 done 集移除
        const i = doneNodes.indexOf(ev.to)
        if (i >= 0) doneNodes.splice(i, 1)
      }
      const snap = statusFromSnapshot(ev.status)
      task = {
        ...prev,
        currentNode: ev.to,
        doneNodes,
        status: snap ?? prev.status,
      }
      break
    }
    case 'gate':
      task = {
        ...prev,
        gateRecords: [
          ...prev.gateRecords,
          {
            gate: ev.gate,
            kind: ev.kind,
            node: ev.node,
            verdict: ev.verdict,
            iter: ev.iter,
            reviewer: ev.reviewer,
            actor: ev.actor,
            issues: ev.issues,
            ts: ev.ts,
          },
        ],
      }
      break
    case 'run.completed':
      task = { ...prev, status: 'completed', durationS: ev.duration_s }
      break
    case 'run.aborted':
      task = { ...prev, status: 'aborted', blockedReason: ev.reason }
      break
  }

  tasks[ev.task_id] = { ...task, lastSeq: ev.seq, updatedAt: ev.ts }
  const feed = [...state.feed, ev].slice(-FEED_CAP)
  return { ...state, tasks, feed }
}

export const useKanbanStore = defineStore('kanban', {
  state: () => emptyKanbanState(),
  getters: {
    /** 任务卡列表（新任务在前） */
    taskList(state): TaskState[] {
      return Object.values(state.tasks).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )
    },
  },
  actions: {
    /** SSE 事件入口（stream.onEvent 接线目标） */
    applyIncoming(ev: EngineEvent): void {
      this.$patch(applyEvent(this.$state, ev))
    },
    /** 接线消费层：事件归并 + 连接状态跟随；返回 stream 供调用方持有（卸载时 disconnect） */
    connect(stream: EngineStream): EngineStream {
      stream.onEvent((ev) => this.applyIncoming(ev))
      stream.onConnectionChange((c) => {
        this.connection = c
      })
      return stream
    },
    disconnect(stream?: EngineStream): void {
      stream?.close()
      this.connection = 'closed'
    },
  },
})
