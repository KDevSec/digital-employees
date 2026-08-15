<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { Enrollment } from '../../types'

const rows = ref<Enrollment[]>([])
const error = ref('')
async function load() { rows.value = await api('/api/v1/workbench-enrollments') }
async function approve(item: Enrollment) { await api(`/api/v1/workbench-enrollments/${item.id}/approve`, { method: 'POST' }); await load() }
async function reject(item: Enrollment) {
  const reason = window.prompt('请输入拒绝原因：')
  if (!reason) return
  try { await api(`/api/v1/workbench-enrollments/${item.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); await load() }
  catch (value) { error.value = value instanceof Error ? value.message : '拒绝失败' }
}
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Enrollment</p><h1>接入申请</h1><p>仅系统管理员和平台管理员可处理。</p></div></div><p v-if="error" class="error">{{ error }}</p>
  <div class="panel table-wrap"><table><thead><tr><th>工作台</th><th>申请人</th><th>环境</th><th>版本</th><th>状态</th><th>申请时间</th><th></th></tr></thead><tbody>
    <tr v-for="item in rows" :key="item.id"><td>{{ item.display_name }}</td><td>{{ item.owner_principal_id }}</td><td>{{ item.os }} / {{ item.arch }}</td><td>{{ item.workbench_version }}</td><td><span class="badge">{{ item.status }}</span></td><td>{{ new Date(item.created_at).toLocaleString() }}</td><td><div v-if="item.status === 'PENDING_REVIEW'" class="actions"><button class="button primary" @click="approve(item)">批准</button><button class="button danger" @click="reject(item)">拒绝</button></div></td></tr>
    <tr v-if="rows.length === 0"><td colspan="7" class="empty">没有接入申请。</td></tr></tbody></table></div></section></template>
