<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import Pagination from '../../shell/Pagination.vue'
import type { Enrollment, PaginatedResponse } from '../../types'
import TerminalDetailDrawer from './TerminalDetailDrawer.vue'

const { t } = useI18n()
const session = useSessionStore()
const rows = ref<Enrollment[]>([])
const error = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const selected = ref<Enrollment | null>(null)

function statusLabel(status: string) {
  return { PENDING_REVIEW: t('terminals.pending'), APPROVED: t('terminals.approved'), COMPLETED: t('terminals.approved'), REJECTED: t('terminals.rejected'), CANCELLED: t('terminals.cancelled') }[status] ?? status
}

async function load() {
  try {
    const params = new URLSearchParams({ offset: String(offset.value), limit: String(limit.value) })
    const data = await api<PaginatedResponse<Enrollment>>(`/api/v1/workbench-enrollments?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch (value) {
    error.value = value instanceof Error ? value.message : t('terminals.loadFailed')
  }
}
async function approve(item: Enrollment) {
  try {
    await api(`/api/v1/workbench-enrollments/${item.id}/approve`, { method: 'POST' })
    await load()
  } catch (value) {
    error.value = value instanceof Error ? value.message : t('terminals.approveFailed')
  }
}
async function reject(item: Enrollment) {
  const reason = window.prompt(t('terminals.rejectPrompt'))
  if (!reason) return
  try {
    await api(`/api/v1/workbench-enrollments/${item.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
    await load()
  } catch (value) {
    error.value = value instanceof Error ? value.message : t('terminals.rejectFailed')
  }
}
function fmt(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : t('terminals.noValue')
}
onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">Enrollment</p>
        <h1>{{ t('terminals.enrollmentsTitle') }}</h1>
        <p>{{ t('terminals.enrollmentsSubtitle') }}</p>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('terminals.index') }}</th>
            <th>{{ t('terminals.terminalName') }}</th>
            <th>{{ t('terminals.owner') }}</th>
            <th>{{ t('terminals.org') }}</th>
            <th>{{ t('terminals.osArch') }}</th>
            <th>{{ t('terminals.version') }}</th>
            <th>{{ t('terminals.status') }}</th>
            <th>{{ t('terminals.appliedAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in rows" :key="item.id" class="clickable" @click="selected = item">
            <td>{{ offset + index + 1 }}</td>
            <td>{{ item.display_name }}</td>
            <td><strong>{{ item.owner_display_name }}</strong></td>
            <td>{{ item.org_path || t('terminals.noValue') }}</td>
            <td>{{ [item.os, item.arch].filter(Boolean).join(' / ') }}</td>
            <td>{{ item.workbench_version }}</td>
            <td>
              <span class="badge" :class="item.status === 'REJECTED' ? 'danger' : item.status === 'PENDING_REVIEW' ? 'warning' : item.status === 'CANCELLED' ? 'muted' : 'success'">{{ statusLabel(item.status) }}</span>
              <small v-if="item.review_reason">{{ item.review_reason }}</small>
            </td>
            <td>{{ fmt(item.created_at) }}</td>
            <td>
              <div class="actions">
                <template v-if="item.status === 'PENDING_REVIEW' && session.can('workbench.enrollment.review')">
                  <button class="button primary" type="button" @click.stop="approve(item)">{{ t('terminals.approve') }}</button>
                  <button class="button danger" type="button" @click.stop="reject(item)">{{ t('terminals.reject') }}</button>
                </template>
                <button class="button ghost" type="button" @click.stop="selected = item">{{ t('terminals.viewDetail') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="rows.length === 0"><td colspan="9" class="empty">{{ t('terminals.noValue') }}</td></tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>

    <TerminalDetailDrawer :row="selected" @close="selected = null" />
  </section>
</template>
