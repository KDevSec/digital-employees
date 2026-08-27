<script setup lang="ts">
/**
 * 事件观战卡（L5 v0.2，对齐 1.0「实时动作流」黑底观战形态；B4 用户裁决：
 * 数据源 = 六类引擎事件，真 stdout 观战留引擎线/V0.2）：tail 式追加最新在下自动滚底，
 * 黑底等宽字体。摘要为中文人话——观战者不用懂事件 schema。
 */
import { ref, watch, nextTick } from 'vue'
import type { EngineEvent } from '../../api/engine-events'

const props = defineProps<{
  feed: EngineEvent[]
  /** 员工 display 映射（摘要里员工显示中文名） */
  employees?: Record<string, string>
}>()

const boxEl = ref<HTMLElement | null>(null)

function emp(name: string): string {
  return props.employees?.[name] ?? name
}

function timeOf(ts: string): string {
  return ts.slice(11, 19)
}

/** 事件 → 中文摘要行 */
function summarize(ev: EngineEvent): string {
  switch (ev.type) {
    case 'run.created':
      return `任务发起「${ev.title}」`
    case 'dispatch':
      if (ev.phase === 'start') return `→ ${emp(ev.emp)} 派发至 ${ev.node ?? '?'}`
      return `${ev.status === 'blocked' ? '✕ 派发失败' : '✓'} ${emp(ev.emp)} 完成 ${ev.node ?? '?'}`
    case 'transition':
      return `${ev.from ?? '∅'} → ${ev.to}${ev.reflow ? '（回流重派）' : ''}${ev.status === 'gate_paused' ? ' ｜停靠待人工' : ''}`
    case 'gate':
      return `${ev.actor === 'human' ? '人工' : '评审'} ${ev.gate} ${ev.verdict} 第${ev.iter}轮${ev.issues?.length ? `（${ev.issues.length} 项问题）` : ''}`
    case 'run.completed':
      return `任务完成（${Math.round(ev.duration_s / 60)} 分钟）`
    case 'run.aborted':
      return `任务终止：${ev.reason}`
  }
}

// feed 增长 → 自动滚底（tail 式观战，对齐 1.0 实时动作流行为）
watch(
  () => props.feed.length,
  async () => {
    await nextTick()
    // scrollTo?. 方法级探测：jsdom 元素无 scrollTo 实现，缺方法时跳过滚底（真浏览器不受影响）
    boxEl.value?.scrollTo?.({ top: boxEl.value.scrollHeight })
  },
)
</script>

<template>
  <div ref="boxEl" class="watch-box">
    <p v-if="feed.length === 0" class="watch-empty">连接事件流…</p>
    <div v-for="ev in feed" :key="`${ev.task_id}-${ev.seq}`" class="watch-line" :class="ev.type.replace('.', '-')">
      <time>{{ timeOf(ev.ts) }}</time>
      <span class="wtype">{{ ev.type }}</span>
      <span class="wtext">{{ summarize(ev) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 1.0 实时动作流语言：黑底 pre 观战 */
.watch-box {
  background: var(--ink);
  color: #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 11.5px;
  font-family: Menlo, Consolas, monospace;
  height: 260px;
  overflow-y: auto;
  line-height: 1.7;
}

.watch-empty {
  color: var(--g400);
}

.watch-line {
  display: flex;
  gap: 10px;
  white-space: nowrap;
}

.watch-line time {
  color: #64748b;
  flex-shrink: 0;
}

.wtype {
  color: #60a5fa;
  flex-shrink: 0;
  min-width: 96px;
}

.watch-line.dispatch .wtype {
  color: #22d3ee;
}

.watch-line.gate .wtype {
  color: #fbbf24;
}

.watch-line.run-completed .wtext {
  color: #4ade80;
}

.watch-line.run-aborted .wtext {
  color: #f87171;
}

.wtext {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
