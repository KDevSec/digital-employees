<script setup lang="ts">
/**
 * 评审流水面板（L5 看板线 T7，设计 §8 纪律④）：gate verdict（PASS/FAIL）+ 人工 confirm
 * （approve/reject）+ run 生命周期行合并时间线，最新在上，展示 cap 50。
 * 人工行 amber 类 + 「人工」标注——1.0 教训「人工 confirm 也进流水」的落点。
 */
import { computed } from 'vue'
import type { EngineEvent } from '../../api/engine-events'
import type { GateRecord } from '../../stores/kanban'

const props = defineProps<{
  records: GateRecord[]
  /** 全局事件流水（run.* 生命周期行来源；可选） */
  feed?: EngineEvent[]
  cap?: number
}>()

interface FeedRow {
  key: string
  ts: string
  cls: string
  text: string
}

const rows = computed<FeedRow[]>(() => {
  const gateRows: FeedRow[] = props.records.map((r) => ({
    key: `g-${r.gate}-${r.iter}-${r.ts}`,
    ts: r.ts,
    cls: r.verdict === 'PASS' ? 'pass' : r.verdict === 'FAIL' ? 'fail' : 'human',
    text:
      `${r.actor === 'human' ? '（人工）' : ''}${r.gate} · ${r.verdict} · 第${r.iter}轮` +
      (r.issues?.length ? ` · ${r.issues.length} 项问题` : ''),
  }))
  const runRows: FeedRow[] = (props.feed ?? [])
    .filter((e) => e.type === 'run.created' || e.type === 'run.completed' || e.type === 'run.aborted')
    .map((e) => ({
      key: `r-${e.seq}`,
      ts: e.ts,
      cls: e.type === 'run.aborted' ? 'fail' : e.type === 'run.completed' ? 'pass' : 'run',
      text:
        e.type === 'run.created'
          ? '任务发起'
          : e.type === 'run.completed'
            ? '任务完成'
            : '任务终止',
    }))
  return [...gateRows, ...runRows]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, props.cap ?? 50)
})

function timeOf(ts: string): string {
  return ts.slice(11, 19)
}
</script>

<template>
  <div class="feed-panel">
    <h4 class="feed-title">评审流水</h4>
    <div class="feed-list">
      <div v-for="row in rows" :key="row.key" class="feed-row" :class="row.cls">
        <time>{{ timeOf(row.ts) }}</time>
        <span>{{ row.text }}</span>
      </div>
      <p v-if="rows.length === 0" class="feed-empty">暂无流水</p>
    </div>
  </div>
</template>

<style scoped>
/* 原型 event-feed/event-item 语言 */
.feed-panel {
  border-top: 1px dashed var(--g200);
  margin-top: 12px;
  padding-top: 10px;
}

.feed-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g600);
  margin-bottom: 6px;
}

.feed-row {
  display: flex;
  gap: 9px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--g100);
  font-size: 12px;
  color: var(--g700);
}

.feed-row:last-child {
  border-bottom: none;
}

.feed-row time {
  color: var(--g400);
  font-size: 11px;
  white-space: nowrap;
  font-family: Menlo, Consolas, monospace;
}

.feed-row.pass span {
  color: var(--green);
}

.feed-row.fail span {
  color: var(--red);
}

.feed-row.human span {
  color: var(--amber);
}

.feed-row.run span {
  color: var(--g500);
}

.feed-empty {
  color: var(--g400);
  font-size: 12px;
  padding: 6px 0;
}
</style>
