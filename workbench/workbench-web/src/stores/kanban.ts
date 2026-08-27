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
import type { EngineApi } from '../api/engine-api'
import type { EngineEvent } from '../api/engine-events'
import type { TableSnapshot } from '../api/engine-table'

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
  /** 表快照（task_id 键；经 getTask 下发，契约歧义 A 的先行口径） */
  tables: Record<string, TableSnapshot>
  /** 员工 display 映射（经 getTask 下发，契约歧义 B 的先行口径） */
  employeesMap: Record<string, string>
}

/** 全局流水滚动窗口上限 */
export const FEED_CAP = 200

export function emptyKanbanState(): KanbanState {
  return { connection: 'connecting', tasks: {}, feed: [], tables: {}, employeesMap: {} }
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
        // 引擎事件 display_name 条件展开（solo 动态表无）——缺省空串
        displayName: ev.display_name ?? '',
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
            ev.status === 'blocked'
              ? (prev.blockedReason ?? `派发失败：${ev.emp}${ev.node ? `（${ev.node}）` : ''}`)
              : prev.blockedReason,
        }
      }
      break
    case 'transition': {
      const doneNodes = [...prev.doneNodes]
      if (ev.from && !doneNodes.includes(ev.from)) doneNodes.push(ev.from)
      // 回流重置（双口径合并）：① 显式 reflow=true（R2 机械回流标志）② 重访即返工——
      // 引擎 R3 gate 回流的 transition.reflow=false（reflow 标志只属 R2 两套溢出语义，
      // L3 实测），落点若已在 done 集同样重置为活跃，否则返工期间阶段进度虚高、chip 卡 done
      if (ev.reflow || doneNodes.includes(ev.to)) {
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
    /** SSE 事件入口（stream.onEvent 接线目标）。per-task seq 幂等——初值重放（hydrate）
     *  与 SSE 增量/Last-Event-ID 回放窗口重叠不重复入状态（事件 seq=行号，append-only 单调） */
    applyIncoming(ev: EngineEvent): void {
      const prev = this.tasks[ev.task_id]
      if (prev && ev.seq <= prev.lastSeq) return
      const next = applyEvent(this.$state, ev)
      this.tasks = next.tasks
      this.feed = next.feed
    },
    /** 初值拉取（重载不丢板）：任务清单（活动+归档）→ 每任务事件重放（事件溯源式重建，
     *  表快照由视图层 tasks watcher 补拉）。已在本会话建卡的任务跳过（SSE 增量已在管） */
    async hydrate(api: EngineApi): Promise<void> {
      let list: { tasks: { task_id: string }[]; archived: { task_id: string }[] }
      try {
        list = await api.listTasks()
      } catch {
        return // 引擎未通：保持空板（连接态由 SSE 层表达）
      }
      for (const t of [...list.tasks, ...list.archived]) {
        if (this.tasks[t.task_id]) continue
        try {
          const events = await api.getEvents(t.task_id, 0)
          for (const ev of events) this.applyIncoming(ev)
        } catch {
          // 单任务事件拉取失败不拖垮其余任务（该任务保持缺席，SSE 增量仍会补）
        }
      }
    },
    /** 表快照/员工映射写入（getTask 装配产物落地；表未到/拉取失败 → undefined 只更员工映射，
     *  tables 不落键——保持骨架态且下次任务列表变动可重试） */
    setTable(taskId: string, table: TableSnapshot | undefined, employees?: Record<string, string>): void {
      if (table) this.tables = { ...this.tables, [taskId]: table }
      if (employees) this.employeesMap = { ...this.employeesMap, ...employees }
    },
    /** 发起成功即建占位卡（createTask 202 与 SSE run.created 之间的窗口；归并幂等覆盖） */
    seedTask(taskId: string, partial?: { title?: string }): void {
      if (this.tasks[taskId]) return
      this.tasks = {
        ...this.tasks,
        [taskId]: placeholderTask(taskId, 0, new Date().toISOString()),
      }
      if (partial?.title) this.tasks[taskId].title = partial.title
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
