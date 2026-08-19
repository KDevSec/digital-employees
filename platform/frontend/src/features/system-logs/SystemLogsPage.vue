<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import type { PaginatedResponse, SystemLog } from '../../types'

const { t } = useI18n()
const rows = ref<SystemLog[]>([])
const level = ref('')
const keyword = ref('')
const offset = ref(0)
const limit = ref(100)
const total = ref(0)
const loading = ref(false)

const levelClass: Record<string, string> = {
  DEBUG: 'badge',
  INFO: 'badge success',
  WARNING: 'badge warning',
  ERROR: 'badge danger',
}

async function search() {
  offset.value = 0
  await load()
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('offset', String(offset.value))
    params.set('limit', String(limit.value))
    if (level.value) params.set('level', level.value)
    if (keyword.value) params.set('q', keyword.value)
    const data = await api<PaginatedResponse<SystemLog>>(`/api/v1/system-logs?${params}`)
    rows.value = data.items
    total.value = data.total
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">System</p>
        <h1>{{ t('systemLogs.title') }}</h1>
        <p>{{ t('systemLogs.subtitle') }}</p>
      </div>
    </div>

    <div class="toolbar">
      <select v-model="level" class="field" @change="search">
        <option value="">{{ t('systemLogs.allLevels') }}</option>
        <option value="DEBUG">DEBUG</option>
        <option value="INFO">INFO</option>
        <option value="WARNING">WARNING</option>
        <option value="ERROR">ERROR</option>
      </select>
      <input v-model="keyword" class="field" :placeholder="t('systemLogs.keyword')" @keyup.enter="search" />
      <button class="button" @click="search">{{ t('systemLogs.search') }}</button>
    </div>

    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('systemLogs.timestamp') }}</th>
            <th>{{ t('systemLogs.level') }}</th>
            <th>{{ t('systemLogs.logger') }}</th>
            <th>{{ t('systemLogs.traceId') }}</th>
            <th>{{ t('systemLogs.message') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in rows" :key="index">
            <td class="nowrap">{{ item.timestamp ? new Date(item.timestamp).toLocaleString() : '-' }}</td>
            <td><span :class="levelClass[item.level] || 'badge'">{{ item.level }}</span></td>
            <td class="mono small">{{ item.logger || '-' }}</td>
            <td class="mono small">{{ item.trace_id || '-' }}</td>
            <td class="log-message">{{ item.message }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="5" class="empty">{{ loading ? t('systemLogs.loading') : t('systemLogs.noData') }}</td>
          </tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>
  </section>
</template>

<style scoped>
.nowhite-space { white-space: nowrap; }
.small { font-size: 11px; }
.log-message { word-break: break-word; max-width: 600px; }
</style>
