<script setup lang="ts">
/**
 * SSE 连接态条（L5 看板线 T7）：ConnectionBar 四态（live/reconnecting/connecting/closed）
 * ——断线重连的常驻可视化（重连中 amber），对齐 §8 契约的连接语义。
 */
import type { Connection } from '../../api/engine-stream'

const props = defineProps<{ connection: Connection }>()

const META: Record<Connection, { text: string; cls: string }> = {
  live: { text: '实时连接', cls: 'live' },
  reconnecting: { text: '重连中', cls: 'reconnecting' },
  connecting: { text: '连接中', cls: 'connecting' },
  closed: { text: '已断开', cls: 'closed' },
}

const meta = () => META[props.connection]
</script>

<template>
  <div class="conn-bar" :class="meta().cls">
    <span class="dot"></span>
    <span>{{ meta().text }}</span>
  </div>
</template>

<style scoped>
/* 原型 board-pulse 语言的迷你状态条 */
.conn-bar {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 99px;
  padding: 4px 12px;
  font-size: 11.5px;
  color: var(--g500);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--g400);
}

.conn-bar.live .dot {
  background: var(--green);
  box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.15);
}

.conn-bar.live {
  color: var(--green);
}

.conn-bar.reconnecting .dot {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15);
  animation: conn-blink 1s ease-in-out infinite;
}

.conn-bar.reconnecting {
  color: var(--amber);
  border-color: #fcd34d;
}

.conn-bar.connecting .dot {
  background: var(--blue-500);
}

@keyframes conn-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
</style>
