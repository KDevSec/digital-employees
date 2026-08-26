<script setup lang="ts">
/**
 * 任务大卡（L5 看板线 T8）：单任务完整视图——头（title/状态 tag/flow display/workspace）+
 * 常驻错误条（aborted/blocked，纪律⑥）+ 闸位停靠条 + 阶段泳道横排（deriveBoard 驱动，
 * 零硬编码）+ 评审流水。表快照未到时骨架态（契约歧义 A：表经 getTask 下发）。
 * 视觉 = 原型 run-card/kanban-5 语言。
 */
import { computed } from 'vue'
import type { EngineEvent } from '../../api/engine-events'
import type { TableSnapshot } from '../../api/engine-table'
import type { TaskState, TaskStatus } from '../../stores/kanban'
import { deriveBoard } from '../../stores/derive-board'
import EventFeedPanel from './EventFeedPanel.vue'
import GatePauseBar from './GatePauseBar.vue'
import StageLane from './StageLane.vue'

const props = defineProps<{
  task: TaskState
  table: TableSnapshot | null
  employees: Record<string, string>
  /** 本任务事件（调用方已按 task_id 过滤；run 生命周期行的数据源） */
  feed: EngineEvent[]
}>()

defineEmits<{ confirm: [task: TaskState]; reject: [task: TaskState] }>()

const STATUS_META: Record<TaskStatus, { text: string; cls: string }> = {
  in_progress: { text: '进行中', cls: 'in-progress' },
  gate_paused: { text: '闸位停靠', cls: 'gate-paused' },
  blocked: { text: '阻塞', cls: 'blocked' },
  completed: { text: '已完成', cls: 'completed' },
  aborted: { text: '已终止', cls: 'aborted' },
}

const statusMeta = computed(() => STATUS_META[props.task.status])
const board = computed(() => (props.table ? deriveBoard(props.table, props.task) : null))
</script>

<template>
  <div class="run-card">
    <div class="run-head">
      <div class="run-title">
        <b>{{ task.title }}</b>
        <span class="status-tag" :class="statusMeta.cls">{{ statusMeta.text }}</span>
      </div>
      <div class="run-meta">
        <span><b>{{ task.displayName || task.flow }}</b></span>
        <span class="mono">{{ task.workspace }}</span>
        <span v-if="task.durationS != null">耗时 {{ Math.round(task.durationS / 60) }} 分钟</span>
      </div>
    </div>

    <div v-if="task.blockedReason" class="blocked-bar">{{ task.blockedReason }}</div>

    <GatePauseBar :task="task" @confirm="$emit('confirm', task)" @reject="$emit('reject', task)" />

    <div v-if="board" class="kanban-5">
      <StageLane v-for="stage in board.stages" :key="stage.name" :stage="stage" :employees="employees" />
    </div>
    <div v-else class="skeleton">表快照加载中…</div>

    <EventFeedPanel :records="task.gateRecords" :feed="feed" />
  </div>
</template>

<style scoped>
/* 原型 run-card/kanban.kanban-5 语言 */
.run-card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
  padding: 17px 19px;
  margin-bottom: 13px;
}

.run-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}

.run-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.status-tag.in-progress {
  background: var(--blue-100);
  color: var(--blue-800);
}

.status-tag.gate-paused {
  background: var(--amber-bg);
  color: var(--amber);
}

.status-tag.blocked,
.status-tag.aborted {
  background: var(--red-bg);
  color: var(--red);
}

.status-tag.completed {
  background: var(--green-bg);
  color: var(--green);
}

.run-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--g500);
  margin-left: auto;
}

.run-meta b {
  color: var(--ink);
  font-weight: 600;
}

.mono {
  font-family: Menlo, Consolas, monospace;
  font-size: 11px;
}

.blocked-bar {
  background: var(--red-bg);
  border: 1px solid #fecaca;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 12.5px;
  color: var(--red);
  margin-bottom: 12px;
}

.kanban-5 {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  align-items: start;
}

@media (max-width: 1100px) {
  .kanban-5 {
    grid-template-columns: repeat(2, 1fr);
  }
}

.skeleton {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--g400);
  font-size: 12.5px;
  background: var(--g100);
  border-radius: 12px;
}
</style>
