<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'

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
}

const { t } = useI18n()
const values = reactive<Record<string, any>>({
  challenge_ttl_seconds: 300,
  machine_token_ttl_seconds: 300,
  heartbeat_offline_seconds: 90,
  directory_sync_ttl_seconds: 60,
  log_level: 'INFO',
  log_dir: '/var/log/platform',
  oidc_issuer: '',
  oidc_client_id: '',
  iam_sync_client_id: '',
  oidc_realm: '',
  platform_base_url: '',
})
const readonly = reactive({
  package_storage_path: '',
})
const message = ref('')

onMounted(async () => {
  const data = await api<SettingsData>('/api/v1/platform-settings')
  Object.assign(values, data)
  Object.assign(readonly, data)
})

async function save() {
  await api('/api/v1/platform-settings', {
    method: 'PUT',
    body: JSON.stringify(values),
  })
  message.value = t('settings.saved')
}
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.subtitle') }}</p>
      </div>
    </div>

    <div class="panel settings-section">
      <h2>{{ t('settings.keycloakSection') }}</h2>
      <p class="section-desc">{{ t('settings.keycloakDesc') }}</p>
      <form class="settings-grid" @submit.prevent>
        <label>{{ t('settings.oidcIssuer') }}
          <input v-model="values.oidc_issuer" class="field" />
        </label>
        <label>{{ t('settings.realm') }}
          <input v-model="values.oidc_realm" class="field" />
        </label>
        <label>{{ t('settings.clientId') }}
          <input v-model="values.oidc_client_id" class="field" />
        </label>
        <label>{{ t('settings.iamSyncClientId') }}
          <input v-model="values.iam_sync_client_id" class="field" />
        </label>
      </form>
    </div>

    <div class="panel settings-section">
      <h2>{{ t('settings.platformSection') }}</h2>
      <p class="section-desc">{{ t('settings.platformDesc') }}</p>
      <form class="settings-grid" @submit.prevent>
        <label>{{ t('settings.platformBaseUrl') }}
          <input v-model="values.platform_base_url" class="field" />
        </label>
        <label>{{ t('settings.packageStoragePath') }}
          <span class="readonly-value">{{ readonly.package_storage_path }}</span>
        </label>
      </form>
    </div>

    <div class="panel settings-section">
      <h2>{{ t('settings.runtimeSection') }}</h2>
      <p class="section-desc">{{ t('settings.runtimeDesc') }}</p>
      <form class="settings-grid" @submit.prevent="save">
        <label>{{ t('settings.challengeTtl') }}
          <input v-model.number="values.challenge_ttl_seconds" class="field" type="number" min="60" max="900" />
        </label>
        <label>{{ t('settings.machineTokenTtl') }}
          <input v-model.number="values.machine_token_ttl_seconds" class="field" type="number" min="60" max="300" />
        </label>
        <label>{{ t('settings.heartbeatOffline') }}
          <input v-model.number="values.heartbeat_offline_seconds" class="field" type="number" min="30" max="3600" />
        </label>
        <label>{{ t('settings.directorySyncTtl') }}
          <input v-model.number="values.directory_sync_ttl_seconds" class="field" type="number" min="0" max="3600" />
        </label>
        <label>{{ t('settings.logLevel') }}
          <select v-model="values.log_level" class="field">
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </label>
        <label>{{ t('settings.logDir') }}
          <input v-model="values.log_dir" class="field" />
        </label>
        <div class="form-actions">
          <button class="button primary" type="submit">{{ t('settings.save') }}</button>
          <span v-if="message" class="success-text">{{ message }}</span>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.settings-section {
  margin-bottom: 1.5rem;
  padding: 1.5rem;
}
.settings-section h2 {
  margin: 0 0 0.25rem;
  font-size: 1.1rem;
}
.section-desc {
  margin: 0 0 1rem;
  color: var(--text-secondary, #666);
  font-size: 0.875rem;
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.settings-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8125rem;
  color: var(--text-secondary, #666);
}
.readonly-value {
  font-size: 0.9375rem;
  color: var(--text-primary, #222);
  padding: 0.5rem 0;
}
.field {
  padding: 0.5rem;
  border: 1px solid var(--border, #ccc);
  border-radius: 4px;
  font-size: 0.9375rem;
}
.form-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.success-text {
  color: var(--success, #2a8);
  font-size: 0.875rem;
}
</style>
