<script setup lang="ts">
/**
 * 左列任务树（L5 v0.2，对齐 1.0 demo 任务看板左列——工作区目录语义，用户裁决修正）：
 * 工作区分组（task.workspace 键）可折叠 → 任务行（状态图标/迷你进度/标题），
 * 点击切换右侧详情。分组键=事件字段（非表内容，零硬编码纪律不涉此层）。
 */
import { computed, ref } from 'vue'
import type { TaskState, TaskStatus } from '../../stores/kanban'

const props = defineProps<{
  tasks: TaskState[]
  selectedId: string | null
  /** 任务→表节点总数（迷你进度分母；表未到不渲染进度条） */
  nodeTotals: Record<string, number>
}>()

defineEmits<{ select: [taskId: string] }>()

const ICON_META: Record<TaskStatus, { icon: string; cls: string }> = {
  in_progress: { icon: '●', cls: 'in-progress' },
  gate_paused: { icon: '⏸', cls: 'gate-paused' },
  blocked: { icon: '■', cls: 'blocked' },
  completed: { icon: '✓', cls: 'completed' },
  aborted: { icon: '✕', cls: 'aborted' },
}

interface Group {
  workspace: string
  tasks: TaskState[]
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, TaskState[]>()
  for (const t of props.tasks) {
    if (!map.has(t.workspace)) map.set(t.workspace, [])
    map.get(t.workspace)!.push(t)
  }
  return [...map.entries()].map(([workspace, tasks]) => ({ workspace, tasks }))
})

/** 折叠集合（默认全展开） */
const collapsed = ref(new Set<string>())

function toggle(workspace: string): void {
  const next = new Set(collapsed.value)
  if (next.has(workspace)) next.delete(workspace)
  else next.add(workspace)
  collapsed.value = next
}

function isCollapsed(workspace: string): boolean {
  return collapsed.value.has(workspace)
}

function pctOf(t: TaskState): number | null {
  const total = props.nodeTotals[t.taskId]
  if (!total) return null
  return Math.round((t.doneNodes.length / total) * 100)
}

function meta(t: TaskState) {
  return ICON_META[t.status]
}
</script>

<template>
  <aside class="sidebar">
    <div v-if="groups.length === 0" class="side-empty">暂无任务</div>
    <div v-for="g in groups" :key="g.workspace" class="ws-group">
      <button class="ws-head" type="button" @click="toggle(g.workspace)">
        <span class="ws-caret" :class="{ collapsed: isCollapsed(g.workspace) }">▾</span>
        <span class="ws-path" :title="g.workspace">{{ g.workspace }}</span>
        <span class="ws-cnt">{{ g.tasks.length }}</span>
      </button>
      <div v-show="!isCollapsed(g.workspace)" class="ws-tasks">
        <button
          v-for="t in g.tasks"
          :key="t.taskId"
          type="button"
          class="task-row"
          :class="{ active: t.taskId === selectedId }"
          @click="$emit('select', t.taskId)"
        >
          <span class="ticon" :class="meta(t).cls">{{ meta(t).icon }}</span>
          <span class="t-body">
            <span class="t-title">{{ t.title }}</span>
            <span v-if="pctOf(t) !== null" class="pcttrack"><i class="pctmini" :style="{ width: `${pctOf(t)}%` }"></i></span>
          </span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  border-right: 1px solid var(--g200);
  background: #fff;
  overflow-y: auto;
  padding: 12px 10px;
}

.side-empty {
  color: var(--g400);
  font-size: 12.5px;
  padding: 20px 10px;
  text-align: center;
}

.ws-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--g600);
  font-family: Menlo, Consolas, monospace;
  text-align: left;
}

.ws-head:hover {
  background: var(--g100);
}

.ws-caret {
  transition: transform 0.15s;
  color: var(--g400);
  flex-shrink: 0;
}

.ws-caret.collapsed {
  transform: rotate(-90deg);
}

.ws-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-cnt {
  background: var(--g100);
  border-radius: 99px;
  padding: 0 7px;
  font-size: 10.5px;
  color: var(--g500);
  flex-shrink: 0;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 7px 8px 7px 22px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

.task-row:hover {
  background: var(--g100);
}

.task-row.active {
  background: var(--blue-50);
  box-shadow: inset 2px 0 0 var(--blue-600);
}

.ticon {
  font-size: 11px;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.ticon.in-progress {
  color: var(--blue-500);
}

.ticon.gate-paused {
  color: #f59e0b;
}

.ticon.blocked,
.ticon.aborted {
  color: var(--red);
}

.ticon.completed {
  color: var(--green);
}

.t-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.t-title {
  font-size: 12.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pcttrack {
  height: 3px;
  border-radius: 99px;
  background: var(--g100);
  overflow: hidden;
}

.pctmini {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--blue-600), var(--blue-400));
}
</style>
