<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiClientError } from '../../api'

interface SettingsData {
  oidc_issuer: string
  oidc_client_id: string
  iam_sync_client_id: string
  oidc_realm: string
  platform_base_url: string
  package_storage_path: string
  challenge_ttl_seconds: number
  machine_token_ttl_seconds: number
  heartbeat_offline_seconds: number
  directory_sync_ttl_seconds: number
  log_level: string
  log_dir: string
  log_max_mb: number
  log_retention_days: number
  log_compress: boolean
}

const { t } = useI18n()
type Tab = 'identity' | 'platform' | 'runtime' | 'logs'
const active = ref<Tab>('runtime')
const tabs: Tab[] = ['identity', 'platform', 'runtime', 'logs']

const values = reactive<Record<string, any>>({
  challenge_ttl_seconds: 300,
  machine_token_ttl_seconds: 300,
  heartbeat_offline_seconds: 90,
  directory_sync_ttl_seconds: 60,
  log_level: 'INFO',
  log_dir: '/var/log/platform',
  log_max_mb: 10,
  log_retention_days: 7,
  log_compress: true,
  oidc_issuer: '',
  oidc_client_id: '',
  iam_sync_client_id: '',
  oidc_realm: '',
  platform_base_url: '',
})
const readonly = reactive({ package_storage_path: '' })
const toast = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
let toastTimer: number | undefined
function showToast(kind: 'success' | 'error', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'success' ? 2200 : 4000)
}
const saving = ref(false)

onMounted(async () => {
  const data = await api<SettingsData>('/api/v1/platform-settings')
  Object.assign(values, data)
  Object.assign(readonly, data)
})

async function save() {
  saving.value = true
  try {
    await api('/api/v1/platform-settings', { method: 'PUT', body: JSON.stringify(values) })
    showToast('success', t('settings.saved'))
  } catch (reason) {
    showToast('error', reason instanceof ApiClientError ? reason.message : t('errors.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="settings-page">
    <Transition name="toast">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>
    </Transition>

    <div class="page-heading">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.subtitle') }}</p>
      </div>
    </div>

    <nav class="tab-bar">
      <button v-for="tab in tabs" :key="tab" class="tab" :class="{ active: active === tab }" @click="active = tab">
        {{ t(`settings.tabs.${tab}`) }}
      </button>
    </nav>

    <div class="panel settings-body">
      <form class="settings-grid" @submit.prevent="save">
        <template v-if="active === 'identity'">
          <label>{{ t('settings.oidcIssuer') }}<input v-model="values.oidc_issuer" class="field" /></label>
          <label>{{ t('settings.realm') }}<input v-model="values.oidc_realm" class="field" /></label>
          <label>{{ t('settings.clientId') }}<input v-model="values.oidc_client_id" class="field" /></label>
          <label>{{ t('settings.iamSyncClientId') }}<input v-model="values.iam_sync_client_id" class="field" /></label>
        </template>

        <template v-else-if="active === 'platform'">
          <label>{{ t('settings.platformBaseUrl') }}<input v-model="values.platform_base_url" class="field" /></label>
          <label>{{ t('settings.packageStoragePath') }}<span class="readonly-value">{{ readonly.package_storage_path }}</span></label>
        </template>

        <template v-else-if="active === 'runtime'">
          <label>{{ t('settings.challengeTtl') }}<input v-model.number="values.challenge_ttl_seconds" class="field" type="number" min="60" max="900" /></label>
          <label>{{ t('settings.machineTokenTtl') }}<input v-model.number="values.machine_token_ttl_seconds" class="field" type="number" min="60" max="300" /></label>
          <label>{{ t('settings.heartbeatOffline') }}<input v-model.number="values.heartbeat_offline_seconds" class="field" type="number" min="30" max="3600" /></label>
          <label>{{ t('settings.directorySyncTtl') }}<input v-model.number="values.directory_sync_ttl_seconds" class="field" type="number" min="0" max="3600" /></label>
        </template>

        <template v-else>
          <label>{{ t('settings.logLevel') }}
            <select v-model="values.log_level" class="field">
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
          <label>{{ t('settings.logDir') }}<input v-model="values.log_dir" class="field" /></label>
          <label>{{ t('settings.logMaxMb') }}<input v-model.number="values.log_max_mb" class="field" type="number" min="1" max="512" /></label>
          <label>{{ t('settings.logRetentionDays') }}<input v-model.number="values.log_retention_days" class="field" type="number" min="1" max="90" /></label>
          <label class="toggle-row">
            <input v-model="values.log_compress" type="checkbox" class="switch" />
            <span>{{ t('settings.logCompress') }}</span>
          </label>
        </template>
      </form>
    </div>

    <div class="save-bar">
      <button class="button primary" :disabled="saving" @click="save">{{ t('settings.save') }}</button>
    </div>
  </section>
</template>

<style scoped>
.settings-page { padding-bottom: 80px; }
.tab-bar { display: flex; gap: 4px; margin-bottom: 14px; flex-wrap: wrap; }
.tab { border: 1px solid var(--line); background: #fff; color: var(--muted); padding: 8px 16px; border-radius: 9px; cursor: pointer; font-weight: 750; }
.tab.active { border-color: var(--forest); background: var(--forest); color: #fff; }
.settings-body { padding: 20px; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.settings-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 700; color: var(--muted); }
.readonly-value { font-size: 14px; color: #1f2b29; padding: 9px 0; }
.toggle-row { flex-direction: row !important; align-items: center; gap: 10px; color: #1f2b29 !important; font-size: 13px !important; }
.switch { width: 18px; height: 18px; accent-color: var(--forest); }
.save-bar { position: sticky; bottom: 0; margin-top: 16px; padding: 14px 0; display: flex; justify-content: flex-end; background: linear-gradient(to top, #fff 70%, transparent); }
.toast { position: fixed; top: 84px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 10px 18px; border-radius: 10px; font-weight: 700; box-shadow: 0 12px 40px rgba(18, 60, 53, .18); }
.toast.success { background: #dcf5ec; color: #08775b; }
.toast.error { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }
@media (max-width: 720px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
