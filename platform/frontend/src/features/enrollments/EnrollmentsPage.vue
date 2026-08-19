<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import Pagination from '../../shell/Pagination.vue'
import type { Enrollment, PaginatedResponse } from '../../types'

const { t } = useI18n()
const session = useSessionStore()
const rows = ref<Enrollment[]>([])
const error = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)

function statusLabel(status: string) {
  return { PENDING_REVIEW: '待审批', APPROVED: '已批准', COMPLETED: '已完成', REJECTED: '已拒绝' }[status] ?? status
}

async function load() {
  const params = new URLSearchParams({ offset: String(offset.value), limit: String(limit.value) })
  const data = await api<PaginatedResponse<Enrollment>>(`/api/v1/workbench-enrollments?${params}`)
  rows.value = data.items
  total.value = data.total
}
async function approve(item: Enrollment) { await api(`/api/v1/workbench-enrollments/${item.id}/approve`, { method: 'POST' }); await load() }
async function reject(item: Enrollment) {
  const reason = window.prompt('请输入拒绝原因：')
  if (!reason) return
  try { await api(`/api/v1/workbench-enrollments/${item.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); await load() }
  catch (value) { error.value = value instanceof Error ? value.message : t('enrollments.rejectFailed') }
}
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Enrollment</p><h1>{{ t('enrollments.title') }}</h1><p>部门管理员可审批所属组织及其下级组织的接入申请。</p></div></div><p v-if="error" class="error">{{ error }}</p>
  <div class="panel table-wrap"><table><thead><tr><th>工作台</th><th>申请人</th><th>组织结构</th><th>环境</th><th>版本</th><th>状态</th><th>申请时间</th><th></th></tr></thead><tbody>
    <tr v-for="item in rows" :key="item.id"><td>{{ item.display_name }}</td><td><strong>{{ item.owner_display_name }}</strong><small class="mono">{{ item.owner_principal_id }}</small></td><td>{{ item.org_path || '-' }}</td><td>{{ item.os }} / {{ item.arch }}</td><td>{{ item.workbench_version }}</td><td><span class="badge" :class="item.status === 'REJECTED' ? 'danger' : item.status === 'PENDING_REVIEW' ? 'warning' : 'success'">{{ statusLabel(item.status) }}</span><small v-if="item.review_reason">{{ item.review_reason }}</small></td><td>{{ new Date(item.created_at).toLocaleString() }}</td><td><div v-if="item.status === 'PENDING_REVIEW' && session.can('workbench.enrollment.review')" class="actions"><button class="button primary" @click="approve(item)">{{ t('enrollments.approve') }}</button><button class="button danger" @click="reject(item)">{{ t('enrollments.reject') }}</button></div></td></tr>
    <tr v-if="rows.length === 0"><td colspan="8" class="empty">没有接入申请。</td></tr></tbody></table>
  <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" /></div></section></template>
