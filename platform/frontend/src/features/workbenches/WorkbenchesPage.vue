<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import Pagination from '../../shell/Pagination.vue'
import type { PaginatedResponse, Workbench } from '../../types'

const { t } = useI18n()
const session = useSessionStore()
const rows = ref<Workbench[]>([])
const error = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const keyword = ref('')

function statusLabel(status: string) {
  return {
    ACTIVE: '已激活',
    PENDING_REVIEW: '待审批',
    APPROVED: '已批准待激活',
    REJECTED: '已拒绝',
    REVOKED: '已吊销',
  }[status] ?? status
}

function statusClass(item: Workbench) {
  if (item.status === 'ACTIVE') return 'success'
  if (item.status === 'REJECTED' || item.status === 'REVOKED') return 'danger'
  return 'warning'
}

function submitSearch() {
  offset.value = 0
  load()
}

async function load() {
  try {
    const params = new URLSearchParams({ offset: String(offset.value), limit: String(limit.value), q: keyword.value })
    const data = await api<PaginatedResponse<Workbench>>(`/api/v1/workbenches?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch {
    error.value = t('errors.loadDataFailed')
  }
}
async function revoke(item: Workbench) {
  const reason = window.prompt(t('workbenches.confirmRevoke', { name: item.display_name }))
  if (!reason) return
  try {
    await api(`/api/v1/workbenches/${item.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) })
    await load()
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('workbenches.revokeFailed') }
}
onMounted(load)
</script>

<template>
  <section><div class="page-heading"><div><p class="eyebrow">Workbenches</p><h1>{{ t('workbenches.title') }}</h1><p>{{ t('workbenches.subtitle') }}</p></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="panel"><form class="filters" @submit.prevent="submitSearch"><input v-model="keyword" type="search" placeholder="搜索人员、部门、团队" aria-label="搜索人员、部门、团队"><button class="button primary" type="submit">搜索</button></form></div>
    <div class="panel table-wrap"><table><thead><tr><th>{{ t('workbenches.name') }}</th><th>{{ t('workbenches.owner') }}</th><th>组织结构</th><th>{{ t('workbenches.environment') }}</th><th>{{ t('workbenches.version') }}</th><th>{{ t('workbenches.access') }}</th><th>{{ t('workbenches.connection') }}</th><th>{{ t('workbenches.lastHeartbeat') }}</th><th></th></tr></thead>
      <tbody><tr v-for="item in rows" :key="item.id"><td><strong>{{ item.display_name }}</strong><small class="mono">{{ item.id }}</small><small v-if="item.kind === 'enrollment'" class="mono">接入申请</small></td><td><strong>{{ item.owner_display_name }}</strong><small class="mono">{{ item.owner_principal_id }}</small></td><td>{{ item.org_path || '-' }}</td><td>{{ item.reported_os }} / {{ item.reported_arch }}</td><td>{{ item.reported_version }}</td><td><span class="badge" :class="statusClass(item)">{{ statusLabel(item.status) }}</span><small v-if="item.review_reason">{{ item.review_reason }}</small></td><td>{{ item.kind === 'enrollment' ? '-' : item.connection_status }}</td><td>{{ item.last_heartbeat_at ? new Date(item.last_heartbeat_at).toLocaleString() : t('workbenches.noHeartbeat') }}</td><td><button v-if="session.can('workbench.revoke') && item.status === 'ACTIVE' && item.kind !== 'enrollment'" class="button danger" @click="revoke(item)">{{ t('workbenches.revoke') }}</button></td></tr>
      <tr v-if="rows.length === 0"><td colspan="9" class="empty">{{ t('workbenches.noData') }}</td></tr></tbody></table>
    <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" /></div>
  </section>
</template>
