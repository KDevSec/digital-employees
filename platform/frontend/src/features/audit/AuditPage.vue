<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { AuditEvent } from '../../types'

const rows = ref<AuditEvent[]>([])
const eventType = ref('')
async function load() { rows.value = await api(`/api/v1/audit-events${eventType.value ? `?event_type=${encodeURIComponent(eventType.value)}` : ''}`) }
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Audit</p><h1>审计</h1><p>事件按角色类型和发生时组织快照过滤。</p></div></div>
  <div class="toolbar"><input v-model="eventType" class="field" placeholder="事件类型" /><button class="button" @click="load">查询</button></div>
  <div class="panel table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>主体</th><th>对象</th><th>结果</th><th>摘要</th><th>Trace</th></tr></thead><tbody>
    <tr v-for="item in rows" :key="item.id"><td>{{ new Date(item.occurred_at).toLocaleString() }}</td><td>{{ item.event_type }}</td><td>{{ item.actor_id || '-' }}</td><td>{{ item.target_type }} / {{ item.target_id || '-' }}</td><td>{{ item.result }}</td><td>{{ item.summary }}</td><td class="mono">{{ item.trace_id }}</td></tr>
    <tr v-if="rows.length === 0"><td colspan="7" class="empty">没有可见审计事件。</td></tr></tbody></table></div></section></template>
