<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import type { PackageItem } from '../../types'

const { t } = useI18n()
const packages = ref<PackageItem[]>([])
const error = ref('')

onMounted(async () => {
  try {
    packages.value = await api<PackageItem[]>('/api/v1/public/workbench-packages')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('public.packageLoadFailed')
  }
})

function osLabel(value: string): string {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[value.toLowerCase()] ?? value
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}
</script>

<template>
  <div class="public-page">
    <header class="public-header">
      <RouterLink class="brand" to="/"><span class="brand-mark">数</span><span>数字员工管理平台</span></RouterLink>
      <a class="button primary" href="/auth/login?return_to=/app/overview">{{ t('auth.login') }}</a>
    </header>
    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">{{ t('public.heroEyebrow') }}</p>
          <h1>{{ t('public.heroTitle') }}</h1>
          <p class="lead">{{ t('public.heroDesc') }}</p>
          <a class="button accent" href="#downloads">{{ t('public.downloadCta') }}</a>
        </div>
        <div class="trust-card">
          <h2>{{ t('public.trustTitle') }}</h2>
          <ol>
            <li>{{ t('public.trustStep1') }}</li>
            <li>{{ t('public.trustStep2') }}</li>
            <li>{{ t('public.trustStep3') }}</li>
            <li>{{ t('public.trustStep4') }}</li>
          </ol>
        </div>
      </section>
      <section id="downloads" class="downloads">
        <p class="eyebrow">{{ t('public.downloadsEyebrow') }}</p>
        <h2>{{ t('public.downloadsTitle') }}</h2>
        <p><RouterLink to="/history" class="text-link">{{ t('public.viewHistory') }}</RouterLink></p>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-else-if="packages.length === 0" class="empty">{{ t('public.noPackages') }}</p>
        <div class="package-grid">
          <article v-for="item in packages" :key="item.id" class="package-card">
            <span class="os-mark">{{ osLabel(item.os).slice(0, 3) }}</span>
            <h3>{{ osLabel(item.os) }}</h3>
            <p>{{ item.arch }} · v{{ item.version }}<br><small v-if="item.published_at">{{ new Date(item.published_at).toLocaleDateString() }}</small></p>
            <dl>
              <dt>{{ t('public.fileLabel') }}</dt><dd>{{ item.file_name }}</dd>
              <dt>{{ t('public.sizeLabel') }}</dt><dd>{{ sizeLabel(item.size_bytes) }}</dd>
              <dt>SHA-256</dt><dd class="mono" :title="item.sha256">{{ item.sha256 }}</dd>
              <dt>{{ t('public.signatureLabel') }}</dt><dd><span class="badge success">{{ item.signature_status }}</span></dd>
            </dl>
            <a
              class="button primary"
              :href="`/api/v1/public/workbench-packages/${item.id}/download`"
              :download="item.file_name"
            >{{ t('public.download') }}</a>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
