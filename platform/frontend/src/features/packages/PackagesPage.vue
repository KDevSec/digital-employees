<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import type { PackageItem, PaginatedResponse } from '../../types'

const { t } = useI18n()
const rows = ref<PackageItem[]>([])
const file = ref<File | null>(null)
const form = reactive({ version: '1.0.0', os: 'linux', arch: 'x64', signature_status: 'VALID' })
const message = ref('')
const offset = ref(0)
const limit = ref(20)
const total = ref(0)

async function load() {
  const data = await api<PaginatedResponse<PackageItem>>(`/api/v1/admin/workbench-packages?offset=${offset.value}&limit=${limit.value}`)
  rows.value = data.items
  total.value = data.total
}
async function upload() {
  if (!file.value) return
  const data = new FormData(); Object.entries(form).forEach(([key, value]) => data.append(key, value)); data.append('file', file.value)
  await api('/api/v1/admin/workbench-packages', { method: 'POST', body: data }); message.value = '上传成功，当前为草稿。'; await load()
}
async function change(item: PackageItem, action: 'publish' | 'withdraw') { await api(`/api/v1/admin/workbench-packages/${item.id}/${action}`, { method: 'POST' }); await load() }
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Packages</p><h1>{{ t('packages.title') }}</h1><p>{{ t('packages.subtitle') }}</p></div></div>
  <form class="panel form-grid" @submit.prevent="upload"><label>{{ t('packages.version') }}<input v-model="form.version" class="field" required /></label><label>{{ t('packages.os') }}<select v-model="form.os" class="field"><option>linux</option><option>windows</option><option>macos</option></select></label><label>{{ t('packages.arch') }}<select v-model="form.arch" class="field"><option>x64</option><option>arm64</option></select></label><label>{{ t('packages.signature') }}<select v-model="form.signature_status" class="field"><option>VALID</option><option>UNVERIFIED</option><option>INVALID</option></select></label><label>{{ t('packages.fileName') }}<input class="field" type="file" required @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label><button class="button primary" type="submit">{{ t('packages.upload') }}</button><span class="success-text">{{ message }}</span></form>
  <div class="panel table-wrap"><table><thead><tr><th>{{ t('packages.version') }}</th><th>{{ t('packages.os') }}/{{ t('packages.arch') }}</th><th>{{ t('packages.fileName') }}</th><th>SHA-256</th><th>{{ t('packages.signature') }}</th><th>{{ t('packages.status') }}</th><th></th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ item.version }}</td><td>{{ item.os }} / {{ item.arch }}</td><td>{{ item.file_name }}</td><td class="mono truncate">{{ item.sha256 }}</td><td>{{ item.signature_status }}</td><td>{{ item.status }}</td><td><button v-if="item.status === 'DRAFT'" class="button primary" @click="change(item, 'publish')">{{ t('packages.publish') }}</button><button v-if="item.status === 'PUBLISHED'" class="button danger" @click="change(item, 'withdraw')">{{ t('packages.withdraw') }}</button></td></tr></tbody></table>
  <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" /></div></section></template>