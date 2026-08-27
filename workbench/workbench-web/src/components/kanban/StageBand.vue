<script setup lang="ts">
/**
 * 任务阶段横幅（L5 v0.2，对齐 1.0 stageband）：横向阶段步进格——格数/名称由表快照
 * stage 字段驱动（零硬编码①保留）；每格 pct=阶段内 done 节点/阶段节点总数 + 进度条；
 * done 绿底 / active 蓝呼吸光晕（gate_paused 时 amber）+ gate 末格（通过闸数/总闸数，
 * 刻意不给进度条——1.0 语义）。
 */
import { computed } from 'vue'
import type { TableSnapshot } from '../../api/engine-table'
import { deriveBoard } from '../../stores/derive-board'
import type { TaskState } from '../../stores/kanban'

const props = defineProps<{
  table: TableSnapshot | null
  task: TaskState
}>()

interface StageCell {
  name: string
  pct: number
  done: boolean
  active: boolean
  paused: boolean
}

const cells = computed<StageCell[]>(() => {
  if (!props.table) return []
  const board = deriveBoard(props.table, props.task)
  return board.stages
    .filter((s) => s.name !== '未分组')
    .map((s) => {
      const total = s.nodes.length
      const done = s.nodes.filter((n) => n.state === 'done').length
      const active = s.nodes.some((n) => n.state === 'active' || n.state === 'paused')
      return {
        name: s.name,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
        done: total > 0 && done === total,
        active,
        paused: active && props.task.status === 'gate_paused',
      }
    })
})

/** gate 末格：通过闸数 / 总闸数（gate_specs + 人工闸节点——human_gate 是节点属性不在
 * gate_specs；不给进度条——1.0 语义） */
const gateLine = computed<string | null>(() => {
  if (!props.table) return null
  const total =
    Object.keys(props.table.gate_specs).length +
    props.table.nodes.filter((n) => n.human_gate === true).length
  const passed = props.task.gateRecords.filter((g) => g.verdict === 'PASS' || g.verdict === 'approve').length
  return `${passed}/${total}`
})
</script>

<template>
  <div v-if="table" class="stageband">
    <div
      v-for="c in cells"
      :key="c.name"
      class="sbstage"
      :class="{ done: c.done, active: c.active, paused: c.paused }"
    >
      <div class="sh">
        <span class="snm">{{ c.name }}</span>
        <span class="spct" :class="{ zero: c.pct === 0 }">{{ c.pct }}%</span>
      </div>
      <div class="sbbar"><i :style="{ width: `${c.pct}%` }"></i></div>
    </div>
    <div v-if="gateLine" class="sbstage sbgate" :class="{ alldone: gateLine.endsWith('0') === false && !gateLine.includes('/0') }">
      <span class="gate-lab">闸</span>
      <b class="gate-num">{{ gateLine }}</b>
    </div>
  </div>
  <div v-else class="sb-skeleton">表快照加载中…</div>
</template>

<style scoped>
/* 1.0 stageband 语言：横排格 + done 绿底 + active 呼吸光晕（sbGlow） */
.stageband {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.sbstage {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border: 1px solid var(--g200);
  border-radius: 10px;
  background: #fff;
  min-width: 0;
}

.sbstage.done {
  border-color: rgba(22, 163, 74, 0.35);
  background: linear-gradient(180deg, #f0fdf4, #ffffff);
}

.sbstage.active {
  border-color: var(--blue-500);
  animation: sb-glow 2.2s ease-in-out infinite;
}

.sbstage.paused {
  border-color: #f59e0b;
  animation: sb-glow-amber 2.2s ease-in-out infinite;
}

.sh {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.snm {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spct {
  margin-left: auto;
  font-family: Menlo, Consolas, monospace;
  font-size: 16px;
  font-weight: 800;
  color: var(--blue-600);
}

.spct.zero {
  color: var(--g400);
  font-size: 11.5px;
  font-weight: 600;
}

.sbstage.done .spct {
  color: var(--green);
}

.sbbar {
  height: 4px;
  border-radius: 99px;
  background: var(--g100);
  overflow: hidden;
}

.sbbar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--blue-500);
  transition: width 0.3s ease;
}

.sbstage.done .sbbar i {
  background: var(--green);
}

/* gate 末格：窄列只报数，不给进度条（1.0 语义） */
.sbgate {
  flex: 0 0 92px;
  justify-content: center;
  align-items: center;
  gap: 5px;
  flex-direction: row;
}

.gate-lab {
  font-size: 11px;
  font-weight: 700;
  color: var(--g500);
}

.gate-num {
  font-family: Menlo, Consolas, monospace;
  font-size: 15px;
  font-weight: 800;
  color: var(--g600);
}

.sbgate.alldone .gate-num {
  color: var(--green);
}

.sb-skeleton {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--g400);
  font-size: 12.5px;
  background: var(--g100);
  border-radius: 10px;
}

@keyframes sb-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
  }
}

@keyframes sb-glow-amber {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.2);
  }
}
</style>
