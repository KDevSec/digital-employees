<script setup lang="ts">
/**
 * 评审流水卡（L5 v0.2，对齐 1.0 gtl 时间线形态）：时间·闸·评审方·verdict 配色·轮次·
 * issues 细行；人工 confirm 在场 amber（纪律④）；最新在上 cap 50。
 */
import { computed } from 'vue'
import type { GateRecord } from '../../stores/kanban'

const props = defineProps<{
  records: GateRecord[]
  cap?: number
}>()

interface Row {
  key: string
  ts: string
  cls: string
  gate: string
  reviewer: string
  verdict: string
  iter: number
  human: boolean
  issues: string[]
}

const rows = computed<Row[]>(() => {
  return [...props.records]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, props.cap ?? 50)
    .map((r) => ({
      key: `${r.gate}-${r.iter}-${r.ts}`,
      ts: r.ts,
      cls: r.verdict === 'PASS' ? 'pass' : r.verdict === 'FAIL' ? 'fail' : 'human',
      gate: r.gate,
      reviewer: r.reviewer,
      verdict: r.verdict,
      iter: r.iter,
      human: r.actor === 'human',
      issues: r.issues ?? [],
    }))
})

function timeOf(ts: string): string {
  return ts.slice(11, 19)
}
</script>

<template>
  <div class="gtl">
    <p v-if="rows.length === 0" class="gtl-empty">暂无评审流水</p>
    <div v-for="r in rows" :key="r.key" class="gtl-row" :class="r.cls">
      <time>{{ timeOf(r.ts) }}</time>
      <div class="grow">
        <div class="gmain">
          <b class="ggate mono">{{ r.gate }}</b>
          <span class="gverdict">{{ r.verdict }}</span>
          <span class="giter">第{{ r.iter }}轮</span>
          <span class="grev">{{ r.human ? '人工' : r.reviewer }}</span>
        </div>
        <div v-if="r.issues.length > 0" class="gissues">
          <span v-for="(iss, i) in r.issues" :key="i" class="gissue">· {{ iss }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1.0 gtl 时间线语言 */
.gtl {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow-y: auto;
}

.gtl-empty {
  color: var(--g400);
  font-size: 12px;
  padding: 8px 0;
}

.gtl-row {
  display: flex;
  gap: 12px;
  padding: 9px 2px;
  border-bottom: 1px dashed var(--g100);
}

.gtl-row:last-child {
  border-bottom: none;
}

.gtl-row time {
  color: var(--g400);
  font-size: 11px;
  font-family: Menlo, Consolas, monospace;
  white-space: nowrap;
  padding-top: 2px;
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gmain {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  flex-wrap: wrap;
}

.mono {
  font-family: Menlo, Consolas, monospace;
}

.ggate {
  color: var(--ink);
}

.gverdict {
  font-weight: 700;
}

.gtl-row.pass .gverdict {
  color: var(--green);
}

.gtl-row.fail .gverdict {
  color: var(--red);
}

.gtl-row.human .gverdict {
  color: var(--amber);
}

.giter {
  color: var(--g500);
  font-size: 11.5px;
}

.grev {
  margin-left: auto;
  color: var(--g500);
  font-size: 11.5px;
}

.gtl-row.human .grev {
  color: var(--amber);
}

.gissues {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gissue {
  color: var(--red);
  font-size: 11.5px;
  padding-left: 4px;
}
</style>
