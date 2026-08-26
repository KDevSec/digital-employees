<script setup lang="ts">
/**
 * 员工派发卡（L5 看板线 T6）：dispatch.start→done 之间的员工卡（store activeDispatches 驱动
 * 出现/移除，done 消散由离开过渡承担）；running 态 pulse 呼吸圈（dispatch 动画锚）。
 * displayName 由父级注入（getTask 员工映射，契约歧义 B 的 fixture 口径）。
 */
import type { ActiveDispatch } from '../../stores/kanban'
import type { NodeView } from '../../stores/derive-board'

const props = defineProps<{
  dispatch: ActiveDispatch
  displayName: string
  /** 挂靠节点名（卡片上展示在干哪个节点的活） */
  nodeName?: string
}>()

const node = props.nodeName ?? props.dispatch.node ?? ''
</script>

<template>
  <div class="dispatch-card running">
    <span class="pulse"></span>
    <span class="dc-body">
      <b class="dc-name">{{ displayName }}</b>
      <small class="dc-node">{{ node }}</small>
    </span>
  </div>
</template>

<style scoped>
/* 原型 board-pulse/task-card 语言的迷你版：白卡 + 蓝系 pulse 呼吸 */
.dispatch-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid var(--blue-200);
  border-radius: 9px;
  padding: 7px 10px;
  margin-top: 6px;
  font-size: 11.5px;
  animation: dc-breathe 1.6s ease-in-out infinite;
}

.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.15);
  flex-shrink: 0;
}

.dc-body {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.dc-name {
  font-weight: 600;
  color: var(--ink);
}

.dc-node {
  color: var(--g400);
  font-size: 10px;
  font-family: Menlo, Consolas, monospace;
}

@keyframes dc-breathe {
  0%,
  100% {
    border-color: var(--blue-200);
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
  }
  50% {
    border-color: var(--blue-400);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
}
</style>
