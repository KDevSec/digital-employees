<script setup lang="ts">
/**
 * 泳道列（T4，1.0 ck-lane 形态）：列头 = 彩点 + 名 + 计数徽章；卡体 = 默认插槽
 * （父层渲染 BoardCard / 需求草稿卡）；空态文案。待办池（plan）是唯一 drop 目标
 * （需求池→待办池手动拖拽 = 发起编排）——dragover 放行 + drop 取 text/plain 草稿 id 上抛。
 */
import type { LaneDef } from '../../stores/board'

const props = defineProps<{
  lane: LaneDef
  /** 卡列表（仅取长度计计数；渲染走插槽） */
  cards: unknown[]
}>()

const emit = defineEmits<{ 'drop-need': [needId: string] }>()

function onDrop(e: DragEvent): void {
  if (props.lane.id !== 'plan') return
  const id = e.dataTransfer?.getData('text/plain')
  if (id) emit('drop-need', id)
}
</script>

<template>
  <div
    class="ck-lane"
    :class="{ droppable: lane.id === 'plan' }"
    @dragover="lane.id === 'plan' && $event.preventDefault()"
    @drop="onDrop"
  >
    <div class="lane-head">
      <span class="dot" :class="`dot-${lane.dot}`"></span>
      <span class="lane-name">{{ lane.name }}</span>
      <span class="cnt">{{ cards.length }}</span>
    </div>
    <div class="lane-body">
      <slot></slot>
      <p v-if="cards.length === 0" class="lane-empty">暂无任务</p>
    </div>
  </div>
</template>

<style scoped>
.ck-lane {
  flex: 1 0 0;
  min-width: 252px;
  max-width: 320px;
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ck-lane.droppable {
  border-style: dashed;
  border-color: var(--violet, #8b5cf6);
}

.lane-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--g100);
  font-size: 13px;
  font-weight: 600;
  color: var(--g700);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-blue { background: var(--blue-600, #2563eb); }
.dot-violet { background: #8b5cf6; }
.dot-amber { background: #f59e0b; }
.dot-red { background: var(--red, #ef4444); }
.dot-green { background: var(--green, #22c55e); }

.cnt {
  margin-left: auto;
  background: var(--g100);
  color: var(--g500);
  border-radius: 99px;
  padding: 1px 9px;
  font-size: 11px;
  font-weight: 500;
}

.lane-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lane-empty {
  color: var(--g400);
  font-size: 12px;
  text-align: center;
  padding: 18px 0;
}
</style>
