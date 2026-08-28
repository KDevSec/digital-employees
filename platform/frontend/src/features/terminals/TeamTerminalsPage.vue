<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const keyword = ref('')
const selected = ref<TerminalRosterRow | null>(null)

const notInstalledRows = computed(() => rows.value.filter((row) => row.install_status === 'NOT_INSTALLED'))

function submitSearch() {
  offset.value = 0
  load()
}

async function load() {
  try {
    const params = new URLSearchParams({ scope: 'team', offset: String(offset.value), limit: String(limit.value), q: keyword.value })
    const data = await api<PaginatedResponse<TerminalRosterRow>>(`/api/v1/terminal-roster?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch {
    error.value = t('terminals.loadFailed')
  }
}

function remindOne(row: TerminalRosterRow) {
  if (!window.confirm(t('terminals.remindConfirm', { name: row.owner_display_name }))) return
  window.alert(t('terminals.remindComingSoon'))
}

function remindAll() {
  if (notInstalledRows.value.length === 0) {
    window.alert(t('terminals.noRemindTarget'))
    return
  }
  if (!window.confirm(t('terminals.remindAllConfirm', { count: notInstalledRows.value.length }))) return
  window.alert(t('terminals.remindComingSoon'))
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
        <h1>{{ t('terminals.teamTitle') }}</h1>
        <p>{{ t('terminals.teamSubtitle') }}</p>
      </div>
      <div class="page-actions">
        <button class="button primary" type="button" @click="remindAll">{{ t('terminals.remindAll') }}</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="panel">
      <form class="filters" @submit.prevent="submitSearch">
        <input v-model="keyword" type="search" :placeholder="t('terminals.searchPlaceholder')" :aria-label="t('terminals.searchPlaceholder')">
        <button class="button primary" type="submit">{{ t('terminals.search') }}</button>
      </form>
    </div>

    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('terminals.index') }}</th>
            <th>{{ t('terminals.owner') }}</th>
            <th>{{ t('terminals.org') }}</th>
            <th>{{ t('terminals.hostname') }}</th>
            <th>{{ t('terminals.ip') }}</th>
            <th>{{ t('terminals.version') }}</th>
            <th>{{ t('terminals.status') }}</th>
            <th>{{ t('terminals.lastHeartbeat') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in rows" :key="item.principal_id" class="clickable" @click="selected = item">
            <td>{{ offset + index + 1 }}</td>
            <td><strong>{{ item.owner_display_name }}</strong></td>
            <td>{{ item.org_path || t('terminals.noValue') }}</td>
            <td>{{ item.hostname || item.display_name || t('terminals.noValue') }}</td>
            <td>{{ item.install_status !== 'NOT_INSTALLED' ? (item.ip_address || t('terminals.noValue')) : '—' }}</td>
            <td>{{ item.reported_version || t('terminals.noValue') }}</td>
            <td><span class="badge" :class="installStatusClass(item.install_status)">{{ installStatusLabel(t, item.install_status) }}</span></td>
            <td>{{ item.install_status === 'NOT_INSTALLED' ? t('terminals.noValue') : fmt(item.last_heartbeat_at) }}</td>
            <td>
              <div class="actions">
                <button
                  v-if="item.install_status === 'NOT_INSTALLED'"
                  class="button warning"
                  type="button"
                  @click.stop="remindOne(item)"
                >{{ t('terminals.remind') }}</button>
                <button class="button ghost" type="button" @click.stop="selected = item">{{ t('terminals.viewDetail') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="rows.length === 0"><td colspan="9" class="empty">{{ t('terminals.noRemindTarget') }}</td></tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>

    <TerminalDetailDrawer :row="selected" @close="selected = null" />
  </section>
</template>
