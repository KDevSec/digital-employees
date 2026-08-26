<script setup lang="ts">
/**
 * 阶段泳道（L5 看板线 T6）：deriveBoard.StageView 渲染——阶段名 + done/total 计数 +
 * 节点 chip 竖列 + 活跃派发卡落位（挂在所派节点下）。lane 形态对齐原型。
 */
import type { StageView } from '../../stores/derive-board'
import DispatchCard from './DispatchCard.vue'
import NodeChip from './NodeChip.vue'

const props = defineProps<{
  stage: StageView
  /** 员工 display 映射（getTask 下发；缺映射回退 emp id） */
  employees?: Record<string, string>
}>()

function displayName(emp: string): string {
  return props.employees?.[emp] ?? emp
}
</script>

<template>
  <div class="lane">
    <div class="lane-head">
      <span>{{ stage.name }}</span>
      <span class="cnt">{{ stage.nodes.filter((n) => n.state === 'done').length }}/{{ stage.nodes.length }}</span>
    </div>
    <div class="lane-nodes">
      <div v-for="node in stage.nodes" :key="node.id" class="lane-node">
        <NodeChip :node="node" />
        <DispatchCard
          v-if="node.activeDispatch"
          :dispatch="node.activeDispatch"
          :display-name="displayName(node.activeDispatch.emp)"
          :node-name="node.name"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原型 lane/lane-head/cnt 语言 */
.lane {
  background: var(--g100);
  border-radius: 13px;
  padding: 12px;
  min-height: 120px;
}

.lane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 11px;
  font-size: 13px;
  font-weight: 600;
  padding: 0 3px;
}

.cnt {
  background: #fff;
  border-radius: 99px;
  padding: 1px 9px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--g600);
  border: 1px solid var(--g200);
}

.lane-nodes {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
}

.lane-node {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  max-width: 100%;
}
</style>
