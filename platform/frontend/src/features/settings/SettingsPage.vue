<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../../api'

const values = reactive({ challenge_ttl_seconds: 300, machine_token_ttl_seconds: 300, heartbeat_offline_seconds: 90 })
const readonly = reactive({ oidc_issuer: '', platform_base_url: '', package_storage_path: '' })
const message = ref('')
onMounted(async () => { const data = await api<typeof values & typeof readonly>('/api/v1/platform-settings'); Object.assign(values, data); Object.assign(readonly, data) })
async function save() { await api('/api/v1/platform-settings', { method: 'PUT', body: JSON.stringify(values) }); message.value = '设置已保存并审计。' }
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Settings</p><h1>平台设置</h1><p>只包含 V0.1 实际使用的参数。</p></div></div><form class="panel settings-form" @submit.prevent="save"><label>OIDC Issuer<input class="field" :value="readonly.oidc_issuer" disabled /></label><label>平台 Base URL<input class="field" :value="readonly.platform_base_url" disabled /></label><label>安装包存储<input class="field" :value="readonly.package_storage_path" disabled /></label><label>Challenge 有效期（秒）<input v-model.number="values.challenge_ttl_seconds" class="field" type="number" min="60" max="900" /></label><label>机器 Token 有效期（秒）<input v-model.number="values.machine_token_ttl_seconds" class="field" type="number" min="60" max="300" /></label><label>离线阈值（秒）<input v-model.number="values.heartbeat_offline_seconds" class="field" type="number" min="30" max="3600" /></label><button class="button primary" type="submit">保存</button><span class="success-text">{{ message }}</span></form></section></template>
