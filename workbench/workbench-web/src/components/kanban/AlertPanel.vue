<script setup lang="ts">
/**
 * 告警卡（L5 v0.2，对齐 1.0 监督员告警卡位）：闸位停靠置顶（含通过/驳回辅按钮——
 * D-kb05 保留，对话式放行为主通道）+ blocked/aborted 常驻（纪律⑥非 toast）。
 * 无告警整卡不渲染（零占位）。
 */
import type { TaskState } from '../../stores/kanban'

defineProps<{ task: TaskState }>()

defineEmits<{ confirm: [task: TaskState]; reject: [task: TaskState] }>()
</script>

<template>
  <div v-if="task.status === 'gate_paused' || task.blockedReason" class="alert-panel">
    <div v-if="task.status === 'gate_paused'" class="alert-row paused">
      <span class="aicon">⏸</span>
      <span class="atext">
        人工闸停靠 <code>{{ task.currentNode }}</code> —— 在任务工作区开底座会话说「批准」即可放行
      </span>
      <span class="aactions">
        <button class="abtn primary" @click="$emit('confirm', task)">通过</button>
        <button class="abtn" @click="$emit('reject', task)">驳回</button>
      </span>
    </div>
    <div v-if="task.blockedReason" class="alert-row" :class="task.status === 'aborted' ? 'aborted' : 'blocked'">
      <span class="aicon">{{ task.status === 'aborted' ? '✕' : '■' }}</span>
      <span class="atext">{{ task.status === 'aborted' ? '任务终止：' : '阻塞：' }}{{ task.blockedReason }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 1.0 告警卡语言：amber 停靠置顶 + 红 blocked/aborted 常驻 */
.alert-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 9px 13px;
  font-size: 12.5px;
  flex-wrap: wrap;
}

.alert-row.paused {
  background: var(--amber-bg);
  border: 1px solid #fcd34d;
  border-left: 4px solid #f59e0b;
  color: var(--amber);
}

.alert-row.blocked {
  background: var(--red-bg);
  border: 1px solid #fecaca;
  border-left: 4px solid var(--red);
  color: var(--red);
}

.alert-row.aborted {
  background: var(--red-bg);
  border: 1px solid #fecaca;
  border-left: 4px solid var(--red);
  color: var(--red);
}

.aicon {
  flex-shrink: 0;
  font-size: 13px;
}

.atext {
  flex: 1;
  min-width: 200px;
}

.atext code {
  font-family: Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgba(220, 38, 38, 0.08);
  padding: 1px 5px;
  border-radius: 5px;
}

.aactions {
  display: flex;
  gap: 8px;
}

.abtn {
  border: 1px solid #f59e0b;
  background: #fff;
  color: var(--amber);
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}

.abtn.primary {
  background: #f59e0b;
  color: #fff;
}

.abtn:hover {
  filter: brightness(0.96);
}
</style>
