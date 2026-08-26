<script setup lang="ts">
/**
 * 节点 chip（L5 看板线 T6）：deriveBoard.NodeView 的渲染原子——四态
 * （done ✓蓝底 / cur 蓝实心+glow / pending 灰 / paused amber）+ gate ⚖ 徽记 + 人工闸标记。
 * 类名即测试锚（动画断类名不断效果）；视觉 = 原型 nc-node 语言。
 */
import type { NodeView } from '../../stores/derive-board'

const props = defineProps<{ node: NodeView }>()

/** pending 无附加类（默认灰）；其余态映射原型类名 */
function stateClass(): string[] {
  const cls: string[] = []
  if (props.node.state === 'done') cls.push('done')
  if (props.node.state === 'active') cls.push('cur')
  if (props.node.state === 'paused') cls.push('paused')
  if (props.node.kind === 'gate') cls.push('gate')
  if (props.node.humanGate) cls.push('human')
  return cls
}
</script>

<template>
  <span class="nc-node" :class="stateClass()">
    <template v-if="node.kind === 'gate'">⚖ </template>{{ node.state === 'done' ? `✓ ${node.name}` : node.name }}
  </span>
</template>

<style scoped>
/* 原型 nc-node：done 蓝底 / cur 蓝实心 glow / pending 灰；paused/human 为看板扩展（amber 系） */
.nc-node {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 99px;
  background: var(--g100);
  color: var(--g500);
  border: 1px solid var(--g200);
  white-space: nowrap;
}

.nc-node.done {
  background: var(--blue-100);
  color: var(--blue-800);
  border-color: var(--blue-200);
}

.nc-node.cur {
  background: var(--blue-600);
  color: #fff;
  border-color: var(--blue-600);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.nc-node.paused {
  background: var(--amber-bg);
  color: var(--amber);
  border-color: #fcd34d;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
}

.nc-node.human {
  border-style: dashed;
}
</style>
