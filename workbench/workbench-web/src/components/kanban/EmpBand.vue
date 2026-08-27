<script setup lang="ts">
/**
 * 员工横条（L5 v0.2，对齐 1.0 empband）：当前派发员工横排
 * （avatar + display 名 + 所在节点 + running 呼吸态）；数据 = task.activeDispatches。
 */
import type { ActiveDispatch } from '../../stores/kanban'

const props = defineProps<{
  dispatches: ActiveDispatch[]
  employees: Record<string, string>
  /** 节点 id → 名（表快照派生；缺省回退 id） */
  nodeNames?: Record<string, string>
}>()

function displayName(emp: string): string {
  return props.employees[emp] ?? emp
}

function nodeName(node: string | null): string {
  if (!node) return ''
  return props.nodeNames?.[node] ?? node
}

function avatarChar(emp: string): string {
  return displayName(emp).charAt(0)
}
</script>

<template>
  <div class="empband">
    <span class="bandlab">当前派发</span>
    <template v-if="dispatches.length > 0">
      <div v-for="d in dispatches" :key="d.dispatchId" class="emp-item running">
        <span class="avatar av-blue">{{ avatarChar(d.emp) }}</span>
        <span class="emp-info">
          <b>{{ displayName(d.emp) }}</b>
          <small class="mono">{{ nodeName(d.node) }}</small>
        </span>
      </div>
    </template>
    <span v-else class="emp-empty">当前无派发</span>
  </div>
</template>

<style scoped>
/* 1.0 empband 语言：横向条 + avatar + 呼吸 */
.empband {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 14px;
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 10px;
  overflow-x: auto;
}

.bandlab {
  font-size: 11px;
  font-weight: 700;
  color: var(--g400);
  letter-spacing: 0.08em;
  flex-shrink: 0;
}

.emp-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 12px 5px 6px;
  border-radius: 99px;
  background: var(--blue-50);
  border: 1px solid var(--blue-100);
  flex-shrink: 0;
}

.emp-item.running {
  animation: emp-breathe 1.8s ease-in-out infinite;
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  color: #fff;
  flex-shrink: 0;
}

.av-blue {
  background: linear-gradient(135deg, var(--blue-600), var(--blue-400));
}

.emp-info {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.emp-info b {
  font-size: 12.5px;
  color: var(--blue-900);
}

.mono {
  font-size: 10.5px;
  color: var(--g500);
  font-family: Menlo, Consolas, monospace;
}

.emp-empty {
  color: var(--g400);
  font-size: 12px;
}

@keyframes emp-breathe {
  0%,
  100% {
    border-color: var(--blue-100);
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
  }
  50% {
    border-color: var(--blue-400);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
}
</style>
