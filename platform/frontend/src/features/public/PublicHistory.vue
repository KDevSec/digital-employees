<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import type { PackageItem, PaginatedResponse } from '../../types'

const { t } = useI18n()
const rows = ref<PackageItem[]>([])
const filterOs = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const error = ref('')

async function load() {
  try {
    const params = new URLSearchParams()
    params.set('offset', String(offset.value))
    params.set('limit', String(limit.value))
    if (filterOs.value) params.set('os', filterOs.value)
    const data = await api<PaginatedResponse<PackageItem>>(`/api/v1/public/workbench-packages/history?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch {
    error.value = t('public.packageLoadFailed')
  }
}

function osLabel(value: string): string {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[value.toLowerCase()] ?? value
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function onFilterChange() { offset.value = 0; load() }

onMounted(load)
</script>

<template>
  <div class="public-page">
    <header class="public-header">
      <RouterLink class="brand" to="/"><span class="brand-mark">数</span><span>数字员工管理平台</span></RouterLink>
      <a class="button primary" href="/auth/login?return_to=/app/overview">{{ t('auth.login') }}</a>
    </header>
    <main>
      <section class="history-section">
        <p class="eyebrow">{{ t('public.downloadsEyebrow') }}</p>
        <h1>{{ t('history.title') }}</h1>
        <p>{{ t('history.subtitle') }}</p>
        <p><RouterLink to="/" class="text-link">{{ t('history.backToDownloads') }}</RouterLink></p>

        <div class="toolbar">
          <select v-model="filterOs" class="field" style="max-width: 160px" @change="onFilterChange">
            <option value="">{{ t('history.filterOs') }}</option>
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
            <option value="macos">macOS</option>
          </select>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('packages.version') }}</th>
                <th>{{ t('packages.os') }}/{{ t('packages.arch') }}</th>
                <th>{{ t('packages.fileName') }}</th>
                <th>{{ t('packages.size') }}</th>
                <th>{{ t('packages.signature') }}</th>
                <th>{{ t('history.publishedAt') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in rows" :key="item.id">
                <td>{{ item.version }}</td>
                <td>{{ osLabel(item.os) }} / {{ item.arch }}</td>
                <td>{{ item.file_name }}</td>
                <td>{{ sizeLabel(item.size_bytes) }}</td>
                <td><span class="badge success">{{ item.signature_status }}</span></td>
                <td>{{ item.published_at ? new Date(item.published_at).toLocaleString() : '-' }}</td>
                <td><a class="button small primary" :href="`/api/v1/public/workbench-packages/${item.id}/download`" :download="item.file_name">{{ t('public.download') }}</a></td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="7" class="empty">{{ t('history.noData') }}</td></tr>
            </tbody>
          </table>
          <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.history-section { max-width: 960px; margin: 0 auto; padding: 40px 20px; }
.text-link { color: var(--forest); font-size: 14px; }
.toolbar { margin: 16px 0; }
</style>
