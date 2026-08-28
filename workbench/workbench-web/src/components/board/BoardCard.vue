<script setup lang="ts">
/**
 * 泳道任务卡（T4，1.0 六件套按 2.0 真实数据收敛）：
 * 标题 / tag 组（状态+流程名+📁工作区名+⚖闸计数） / 错误块（红底常驻·纪律⑥） /
 * 停靠提示（amber dashed） / 决策按钮组（批准 + 驳回必填 note——对话式放行为主通道，
 * 此为辅按钮 D-kb05） / 进度条 + 阶段链 pill（done 绿/cur 蓝/未来灰，表快照驱动零硬编码）/
 * 卡脚（当前员工 + 状态）。派生列不可拖；点卡进详情（emit open）。
 */
import { computed, ref } from 'vue'
import type { TableSnapshot } from '../../api/engine-table'
import type { TaskState } from '../../stores/kanban'
import { deriveBoard } from '../../stores/derive-board'

const props = defineProps<{
  task: TaskState
  table: TableSnapshot | null
  lane: 'plan' | 'exec' | 'decide' | 'done'
  employees?: Record<string, string>
}>()

const emit = defineEmits<{
  open: [taskId: string]
  approve: [taskId: string]
  reject: [taskId: string, note: string]
}>()

const STATUS_TAG: Record<string, { text: string; cls: string }> = {
  in_progress: { text: '进行中', cls: 'tag-blue' },
  gate_paused: { text: '待人工决策', cls: 'tag-amber' },
  blocked: { text: '阻塞', cls: 'tag-red' },
  completed: { text: '已交付', cls: 'tag-green' },
  aborted: { text: '已终止', cls: 'tag-red' },
}

const statusTag = computed(() => STATUS_TAG[props.task.status] ?? { text: props.task.status, cls: 'tag-gray' })

const wsName = computed(() => props.task.workspace.split(/[\\/]/).filter(Boolean).pop() ?? props.task.workspace)

/** 阶段链 pill 三态（表快照 stage 派生；表未到不渲染链） */
interface ChainPill { name: string; state: 'done' | 'cur' | 'future' }
const chain = computed<ChainPill[]>(() => {
  if (!props.table) return []
  const board = deriveBoard(props.table, props.task)
  return board.stages
    .filter((s) => s.name !== '未分组')
    .map((s) => ({
      name: s.name,
      state: s.nodes.every((n) => n.state === 'done')
        ? 'done'
        : s.nodes.some((n) => n.state === 'active' || n.state === 'paused')
          ? 'cur'
          : 'future',
    }))
})

const pct = computed(() => {
  if (!props.table) return props.task.status === 'completed' ? 100 : 0
  const total = props.table.nodes.filter((n) => n.kind !== 'terminal').length
  if (total === 0) return 100
  const done = props.table.nodes.filter((n) => n.kind !== 'terminal' && props.task.doneNodes.includes(n.id)).length
  return Math.round((done / total) * 100)
})

/** 卡脚：当前派发员工（无派发时取当前节点主责） */
const empName = computed(() => {
  const id = props.task.activeDispatches[0]?.emp
    ?? (props.table ? props.table.nodes.find((n) => n.id === props.task.currentNode)?.emp : undefined)
  if (!id) return null
  return { id, display: props.employees?.[id] ?? id }
})

const note = ref('')
</script>

<template>
  <div class="ck-card" :class="`lane-${lane}`" @click="emit('open', task.taskId)">
    <div class="ck-title">{{ task.title }}</div>

    <div class="ck-tags">
      <span class="tag" :class="statusTag.cls">{{ statusTag.text }}</span>
      <span class="tag tag-gray">{{ task.displayName || task.flow }}</span>
      <span class="tag tag-gray">📁 {{ wsName }}</span>
      <span v-if="lane === 'done' && task.status === 'completed'" class="tag tag-green">✓ 交付前评审通过</span>
    </div>

    <div v-if="task.blockedReason" class="ck-block">⚠ {{ task.blockedReason }}</div>

    <div v-if="lane === 'decide'" class="ck-stop">
      停靠：{{ task.currentNode ?? '?' }}——在任务工作区开底座会话说「批准」即可放行，或点下方按钮
    </div>

    <div class="ck-progress">
      <div class="bar"><i :style="{ width: `${pct}%` }"></i></div>
      <div v-if="chain.length" class="chain">
        <span v-for="p in chain" :key="p.name" class="pill" :class="p.state">{{ p.name }}</span>
      </div>
    </div>

    <div v-if="empName" class="ck-foot">
      <span class="avatar">{{ empName.display.slice(0, 1) }}</span>
      <span>{{ empName.display }}</span>
    </div>

    <div v-if="lane === 'decide'" class="ck-decide" @click.stop>
      <input v-model="note" data-f="note" class="note-input" placeholder="驳回需填理由" />
      <button class="btn sm primary act-approve" @click="emit('approve', task.taskId)">批准</button>
      <button class="btn sm ghost act-reject" :disabled="!note.trim()" @click="emit('reject', task.taskId, note)">驳回</button>
    </div>
  </div>
</template>

<style scoped>
.ck-card {
  border: 1px solid var(--g200);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 7px;
  transition: box-shadow 0.15s;
}

.ck-card:hover {
  box-shadow: 0 2px 8px rgba(30, 64, 175, 0.12);
}

.ck-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g800);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ck-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}

.tag-gray { background: var(--g100); color: var(--g500); }
.tag-blue { background: var(--blue-100); color: var(--blue-800); }
.tag-amber { background: var(--amber-bg, #fef3c7); color: var(--amber, #d97706); }
.tag-red { background: var(--red-bg, #fee2e2); color: var(--red, #dc2626); }
.tag-green { background: var(--green-bg, #dcfce7); color: var(--green, #16a34a); }

.ck-block {
  background: var(--red-bg, #fee2e2);
  color: var(--red, #dc2626);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11.5px;
  line-height: 1.6;
}

.ck-stop {
  border: 1.5px dashed var(--amber, #f59e0b);
  background: var(--amber-bg, #fffbeb);
  color: var(--amber, #b45309);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11.5px;
  line-height: 1.6;
}

.ck-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar {
  height: 5px;
  border-radius: 99px;
  background: var(--g100);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--blue-600);
  border-radius: 99px;
  transition: width 0.3s;
}

.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pill {
  padding: 1px 7px;
  border-radius: 99px;
  font-size: 10px;
}

.pill.done { background: var(--green-bg, #dcfce7); color: var(--green, #16a34a); }
.pill.cur { background: var(--blue-100); color: var(--blue-800); }
.pill.future { background: var(--g100); color: var(--g400); }

.ck-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--g500);
}

.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--blue-100);
  color: var(--blue-800);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.ck-decide {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.note-input {
  flex: 1 1 100%;
  border: 1px solid var(--g200);
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 11.5px;
  outline: none;
}

.note-input:focus {
  border-color: var(--blue-600);
}

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 7px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  font-weight: 500;
}

.btn.sm { padding: 4px 11px; }
.btn.primary { background: var(--blue-600); color: #fff; }
.btn.ghost { background: #fff; border-color: var(--g200); color: var(--g600); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
