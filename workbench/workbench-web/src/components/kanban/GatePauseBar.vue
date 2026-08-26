<script setup lang="ts">
/**
 * 闸位停靠条（L5 看板线 T7，设计 §8 纪律③）：任务 gate_paused 时常驻 amber 高亮条——
 * 对话式放行为主通道（引导文案指向底座会话说「批准」），通过/驳回辅按钮 emit 给
 * 父级调 confirmGate。错误/停靠常驻卡面，非 toast（纪律⑥同源）。
 */
import type { TaskState } from '../../stores/kanban'

defineProps<{ task: TaskState }>()

defineEmits<{ confirm: []; reject: [] }>()
</script>

<template>
  <div v-if="task.status === 'gate_paused'" class="gate-pause-bar paused">
    <span class="pulse"></span>
    <span class="bar-text">
      人工闸停靠 · <code>{{ task.currentNode }}</code> —— 在任务工作区开底座会话说「批准」即可放行
    </span>
    <span class="bar-actions">
      <button class="bar-btn primary" @click="$emit('confirm')">通过</button>
      <button class="bar-btn" @click="$emit('reject')">驳回</button>
    </span>
  </div>
</template>

<style scoped>
/* 原型 approval-card/board-pulse 的 amber 停靠变体 */
.gate-pause-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--amber-bg);
  border: 1px solid #fcd34d;
  border-left: 4px solid #f59e0b;
  border-radius: 11px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--amber);
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.18);
  flex-shrink: 0;
}

.bar-text {
  flex: 1;
  min-width: 240px;
}

.bar-text code {
  font-family: Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgba(245, 158, 11, 0.12);
  padding: 1px 5px;
  border-radius: 5px;
}

.bar-actions {
  display: flex;
  gap: 8px;
}

.bar-btn {
  border: 1px solid #f59e0b;
  background: #fff;
  color: var(--amber);
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}

.bar-btn.primary {
  background: #f59e0b;
  color: #fff;
}

.bar-btn:hover {
  filter: brightness(0.96);
}
</style>
