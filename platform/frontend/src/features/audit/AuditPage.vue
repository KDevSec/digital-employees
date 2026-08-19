<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import type { AuditEvent, PaginatedResponse } from '../../types'

const { t } = useI18n()
const rows = ref<AuditEvent[]>([])
const category = ref('')
const result = ref('')
const eventType = ref('')
const actorKeyword = ref('')
const keyword = ref('')
const occurredFrom = ref('')
const occurredTo = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)

const eventLabels: Record<string, string> = {
  ENROLLMENT_REQUESTED: t('audit.events.ENROLLMENT_REQUESTED'),
  ENROLLMENT_APPROVED: t('audit.events.ENROLLMENT_APPROVED'),
  ENROLLMENT_REJECTED: t('audit.events.ENROLLMENT_REJECTED'),
  ENROLLMENT_CHALLENGE_ISSUED: t('audit.events.ENROLLMENT_CHALLENGE_ISSUED'),
  WORKBENCH_REGISTERED: t('audit.events.WORKBENCH_REGISTERED'),
  WORKBENCH_REVOKED: t('audit.events.WORKBENCH_REVOKED'),
  WORKBENCH_FIRST_HEARTBEAT: t('audit.events.WORKBENCH_FIRST_HEARTBEAT'),
  LOGIN_SUCCEEDED: t('audit.events.LOGIN_SUCCEEDED'),
  LOGOUT_SUCCEEDED: t('audit.events.LOGOUT_SUCCEEDED'),
  AUTHENTICATION_FAILED: t('audit.events.AUTHENTICATION_FAILED'),
  AUTHORIZATION_DENIED: t('audit.events.AUTHORIZATION_DENIED'),
  PACKAGE_UPLOADED: t('audit.events.PACKAGE_UPLOADED'),
  PACKAGE_PUBLISHED: t('audit.events.PACKAGE_PUBLISHED'),
  PACKAGE_WITHDRAWN: t('audit.events.PACKAGE_WITHDRAWN'),
  PLATFORM_SETTINGS_UPDATED: t('audit.events.PLATFORM_SETTINGS_UPDATED'),
  ORG_ARCHIVED: t('audit.events.ORG_ARCHIVED'),
  ORG_RESTORED: t('audit.events.ORG_RESTORED'),
  PRINCIPAL_STATUS_CHANGED: t('audit.events.PRINCIPAL_STATUS_CHANGED'),
  PRINCIPAL_COLLABORATION_REMOVED: t('audit.events.PRINCIPAL_COLLABORATION_REMOVED'),
}

const categoryClass: Record<string, string> = {
  OPERATION: 'badge',
  SECURITY: 'badge warning',
  AUTH: 'badge success',
}

function eventLabel(type: string): string {
  return eventLabels[type] || type
}

async function search() {
  offset.value = 0
  await load()
}

async function reset() {
  category.value = ''
  result.value = ''
  eventType.value = ''
  actorKeyword.value = ''
  keyword.value = ''
  occurredFrom.value = ''
  occurredTo.value = ''
  await search()
}

async function load() {
  const params = new URLSearchParams()
  params.set('offset', String(offset.value))
  params.set('limit', String(limit.value))
  if (category.value) params.set('category', category.value)
  if (result.value) params.set('result', result.value)
  if (eventType.value) params.set('event_type', eventType.value)
  if (actorKeyword.value) params.set('actor_id', actorKeyword.value)
  if (keyword.value) params.set('q', keyword.value)
  if (occurredFrom.value) params.set('occurred_from', new Date(occurredFrom.value).toISOString())
  if (occurredTo.value) params.set('occurred_to', new Date(occurredTo.value).toISOString())
  const data = await api<PaginatedResponse<AuditEvent>>(`/api/v1/audit-events?${params}`)
  rows.value = data.items
  total.value = data.total
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">Audit</p>
        <h1>{{ t('audit.title') }}</h1>
        <p>{{ t('audit.subtitle') }}</p>
      </div>
    </div>

    <div class="panel filter-panel">
      <div class="filter-grid">
        <label>{{ t('audit.category') }}
          <select v-model="category" class="field">
            <option value="">{{ t('audit.allCategories') }}</option>
            <option value="OPERATION">{{ t('audit.categories.OPERATION') }}</option>
            <option value="SECURITY">{{ t('audit.categories.SECURITY') }}</option>
            <option value="AUTH">{{ t('audit.categories.AUTH') }}</option>
          </select>
        </label>
        <label>{{ t('audit.result') }}
          <select v-model="result" class="field">
            <option value="">{{ t('audit.allResults') }}</option>
            <option value="SUCCESS">{{ t('audit.results.SUCCESS') }}</option>
            <option value="FAILURE">{{ t('audit.results.FAILURE') }}</option>
          </select>
        </label>
        <label>{{ t('audit.eventType') }}
          <input v-model="eventType" class="field" :placeholder="t('audit.eventTypePlaceholder')" list="event-types" />
          <datalist id="event-types">
            <option v-for="(label, code) in eventLabels" :key="code" :value="code">{{ label }}</option>
          </datalist>
        </label>
        <label>{{ t('audit.actor') }}
          <input v-model="actorKeyword" class="field" :placeholder="t('audit.actorPlaceholder')" />
        </label>
        <label>{{ t('audit.keyword') }}
          <input v-model="keyword" class="field" :placeholder="t('audit.keywordPlaceholder')" />
        </label>
        <label>{{ t('audit.timeFrom') }}
          <input v-model="occurredFrom" class="field" type="datetime-local" />
        </label>
        <label>{{ t('audit.timeTo') }}
          <input v-model="occurredTo" class="field" type="datetime-local" />
        </label>
      </div>
      <div class="filter-actions">
        <button class="button primary" @click="search">{{ t('audit.search') }}</button>
        <button class="button" @click="reset">{{ t('audit.reset') }}</button>
      </div>
    </div>

    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('audit.occurredAt') }}</th>
            <th>{{ t('audit.actor') }}</th>
            <th>{{ t('audit.eventType') }}</th>
            <th>{{ t('audit.category') }}</th>
            <th>{{ t('audit.result') }}</th>
            <th>{{ t('audit.target') }}</th>
            <th>{{ t('audit.summary') }}</th>
            <th>{{ t('audit.traceId') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td class="nowrap">{{ new Date(item.occurred_at).toLocaleString() }}</td>
            <td>
              <div class="actor-name">{{ item.actor_display_name || t('audit.anonymous') }}</div>
              <div class="mono small" v-if="item.actor_username">{{ item.actor_username }}</div>
            </td>
            <td>{{ eventLabel(item.event_type) }}</td>
            <td><span :class="categoryClass[item.category] || 'badge'">{{ t(`audit.categories.${item.category}`) }}</span></td>
            <td>
              <span :class="item.result === 'SUCCESS' ? 'badge success' : 'badge danger'">
                {{ t(`audit.results.${item.result}`) }}
              </span>
            </td>
            <td class="small">{{ item.target_display || '-' }}</td>
            <td class="summary-cell">{{ item.summary }}</td>
            <td class="mono small">{{ item.trace_id }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="8" class="empty">{{ t('audit.noData') }}</td>
          </tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>
  </section>
</template>

<style scoped>
.filter-panel { padding: 1rem 1.25rem; margin-bottom: 1rem; }
.filter-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
.filter-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8125rem; color: var(--text-secondary, #666); }
.filter-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.actor-name { font-weight: 600; }
.nowrap { white-space: nowrap; }
.small { font-size: 11px; }
.summary-cell { max-width: 280px; word-break: break-word; }
</style>
