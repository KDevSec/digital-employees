<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import type { PaginatedResponse, TerminalRosterRow } from '../../types'
import TerminalDetailDrawer from './TerminalDetailDrawer.vue'
import { installStatusClass, installStatusLabel } from './terminalStatus'

const { t } = useI18n()
const rows = ref<TerminalRosterRow[]>([])
const error = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const selected = ref<TerminalRosterRow | null>(null)

async function load() {
  try {
    const params = new URLSearchParams({ scope: 'me', offset: String(offset.value), limit: String(limit.value) })
    const data = await api<PaginatedResponse<TerminalRosterRow>>(`/api/v1/terminal-roster?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch {
    error.value = t('terminals.loadFailed')
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
        <p class="eyebrow">Terminal</p>
        <h1>{{ t('terminals.myTitle') }}</h1>
        <p>{{ t('terminals.mySubtitle') }}</p>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="rows.length && rows[0].install_status !== 'NOT_INSTALLED'" class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('terminals.index') }}</th>
            <th>{{ t('terminals.terminalName') }}</th>
            <th>{{ t('terminals.ip') }}</th>
            <th>{{ t('terminals.osArch') }}</th>
            <th>{{ t('terminals.version') }}</th>
            <th>{{ t('terminals.status') }}</th>
            <th>{{ t('terminals.lastHeartbeat') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in rows" :key="item.principal_id" class="clickable" @click="selected = item">
            <td>{{ offset + index + 1 }}</td>
            <td><strong>{{ item.hostname || item.display_name || t('terminals.noValue') }}</strong></td>
            <td>{{ item.ip_address || t('terminals.noValue') }}</td>
            <td>{{ [item.reported_os, item.reported_arch].filter(Boolean).join(' / ') || t('terminals.noValue') }}</td>
            <td>{{ item.reported_version || t('terminals.noValue') }}</td>
            <td><span class="badge" :class="installStatusClass(item.install_status)">{{ installStatusLabel(t, item.install_status) }}</span></td>
            <td>{{ fmt(item.last_heartbeat_at) }}</td>
            <td><button class="button ghost" type="button" @click.stop="selected = item">{{ t('terminals.viewDetail') }}</button></td>
          </tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>

    <div v-else class="panel empty-state">
      <h2>{{ t('terminals.myNotInstalledTitle') }}</h2>
      <p>{{ t('terminals.myNotInstalledDesc') }}</p>
    </div>

    <TerminalDetailDrawer :row="selected" @close="selected = null" />
  </section>
</template>
