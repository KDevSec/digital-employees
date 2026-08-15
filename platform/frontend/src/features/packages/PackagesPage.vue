<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../../api'
import type { PackageItem } from '../../types'

const rows = ref<PackageItem[]>([])
const file = ref<File | null>(null)
const form = reactive({ version: '1.0.0', os: 'linux', arch: 'x64', signature_status: 'VALID' })
const message = ref('')
async function load() { rows.value = await api('/api/v1/admin/workbench-packages') }
async function upload() {
  if (!file.value) return
  const data = new FormData(); Object.entries(form).forEach(([key, value]) => data.append(key, value)); data.append('file', file.value)
  await api('/api/v1/admin/workbench-packages', { method: 'POST', body: data }); message.value = '上传成功，当前为草稿。'; await load()
}
async function change(item: PackageItem, action: 'publish' | 'withdraw') { await api(`/api/v1/admin/workbench-packages/${item.id}/${action}`, { method: 'POST' }); await load() }
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Packages</p><h1>安装包</h1><p>上传、发布和下架仅限系统管理员或平台管理员。</p></div></div>
  <form class="panel form-grid" @submit.prevent="upload"><label>版本<input v-model="form.version" class="field" required /></label><label>OS<select v-model="form.os" class="field"><option>linux</option><option>windows</option><option>macos</option></select></label><label>架构<select v-model="form.arch" class="field"><option>x64</option><option>arm64</option></select></label><label>签名<select v-model="form.signature_status" class="field"><option>VALID</option><option>UNVERIFIED</option><option>INVALID</option></select></label><label>文件<input class="field" type="file" required @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label><button class="button primary" type="submit">上传草稿</button><span class="success-text">{{ message }}</span></form>
  <div class="panel table-wrap"><table><thead><tr><th>版本</th><th>目标</th><th>文件</th><th>SHA-256</th><th>签名</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ item.version }}</td><td>{{ item.os }} / {{ item.arch }}</td><td>{{ item.file_name }}</td><td class="mono truncate">{{ item.sha256 }}</td><td>{{ item.signature_status }}</td><td>{{ item.status }}</td><td><button v-if="item.status === 'DRAFT'" class="button primary" @click="change(item, 'publish')">发布</button><button v-if="item.status === 'PUBLISHED'" class="button danger" @click="change(item, 'withdraw')">下架</button></td></tr></tbody></table></div></section></template>
