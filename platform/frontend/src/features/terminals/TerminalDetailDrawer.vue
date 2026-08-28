<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Enrollment, TerminalRosterRow } from '../../types'
import { installStatusLabel } from './terminalStatus'

const props = defineProps<{ row: TerminalRosterRow | Enrollment | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()

const isRoster = computed(() => (props.row as TerminalRosterRow)?.kind === 'roster')
const r = computed(() => props.row as TerminalRosterRow | null)
const e = computed(() => props.row as Enrollment | null)

function dash(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('terminals.noValue')
  return String(value)
}
function time(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : t('terminals.noValue')
}
function osArch(): string {
  const os = isRoster.value ? r.value?.reported_os : e.value?.os
  const arch = isRoster.value ? r.value?.reported_arch : e.value?.arch
  return [os, arch].filter(Boolean).join(' / ') || t('terminals.noValue')
}
function version(): string {
  return dash(isRoster.value ? r.value?.reported_version : e.value?.workbench_version)
}
function statusText(): string {
  const status = r.value?.install_status ?? ''
  return installStatusLabel(t, status)
}
function statusClass(): string {
  const status = r.value?.install_status ?? ''
  if (status === 'ONLINE') return 'success'
  if (status === 'OFFLINE' || status === 'PENDING') return 'warning'
  if (status === 'REJECTED') return 'danger'
  return 'muted'
}
</script>

<template>
  <div v-if="row" class="drawer-overlay" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true">
      <header class="drawer-head">
        <h2>{{ t('terminals.detail') }}</h2>
        <button class="button ghost" type="button" @click="emit('close')">×</button>
      </header>
      <div class="drawer-body">
        <section class="drawer-section">
          <h3>{{ t('terminals.personInfo') }}</h3>
          <dl>
            <dt>{{ t('terminals.owner') }}</dt><dd>{{ dash(row.owner_display_name) }}</dd>
            <dt>{{ t('terminals.username') }}</dt><dd>{{ dash(isRoster ? r?.username : row.owner_principal_id) }}</dd>
            <dt>{{ t('terminals.email') }}</dt><dd>{{ dash(isRoster ? r?.email : null) }}</dd>
            <dt>{{ t('terminals.org') }}</dt><dd>{{ dash(row.org_path) }}</dd>
          </dl>
        </section>

        <section v-if="isRoster" class="drawer-section">
          <h3>{{ t('terminals.installStatus') }}</h3>
          <p><span class="badge" :class="statusClass()">{{ statusText() }}</span></p>
        </section>

        <section class="drawer-section">
          <h3>{{ t('terminals.terminalMetadata') }}</h3>
          <dl>
            <!-- 024：页面只展示安装ID（平台实例 UUID 为内部标识，不展示）；元数据收敛为名称/系统架构/版本/IP/MAC/心跳/安装时间 -->
            <dt>{{ t('terminals.terminalName') }}</dt><dd>{{ dash(isRoster ? (r?.hostname ?? r?.display_name) : e?.display_name) }}</dd>
            <dt>{{ t('terminals.installationId') }}</dt><dd class="mono">{{ dash(r?.installation_id ?? null) }}</dd>
            <dt>{{ t('terminals.osArch') }}</dt><dd>{{ osArch() }}</dd>
            <dt>{{ t('terminals.version') }}</dt><dd>{{ version() }}</dd>
            <dt>{{ t('terminals.ip') }}</dt><dd>{{ dash(r?.ip_address ?? null) }}</dd>
            <dt>{{ t('terminals.macAddresses') }}</dt><dd>{{ dash(r?.mac_address ?? null) }}</dd>
            <dt>{{ t('terminals.firstHeartbeat') }}</dt><dd>{{ time(r?.first_heartbeat_at) }}</dd>
            <dt>{{ t('terminals.lastHeartbeat') }}</dt><dd>{{ time(r?.last_heartbeat_at) }}</dd>
            <dt>{{ t('terminals.installedAt') }}</dt><dd>{{ time(r?.created_at) }}</dd>
          </dl>
        </section>

        <section class="drawer-section">
          <h3>{{ t('terminals.enrollmentInfo') }}</h3>
          <dl>
            <dt>{{ t('terminals.appliedAt') }}</dt><dd>{{ time(isRoster ? (r?.enrollment_id ? r?.created_at : null) : e?.created_at) }}</dd>
            <dt>{{ t('terminals.reviewReason') }}</dt><dd>{{ dash(row.review_reason) }}</dd>
          </dl>
        </section>
      </div>
    </aside>
  </div>
</template>
