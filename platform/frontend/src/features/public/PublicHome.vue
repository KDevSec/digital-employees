<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../../api'
import type { PackageItem } from '../../types'

const packages = ref<PackageItem[]>([])
const error = ref('')

onMounted(async () => {
  try {
    packages.value = await api<PackageItem[]>('/api/v1/public/workbench-packages')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '安装包加载失败'
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
      <RouterLink class="brand" to="/"><span class="brand-mark">A</span><span>Atlas Workbench</span></RouterLink>
      <a class="button primary" href="/auth/login?return_to=/app/overview">登录管理平台</a>
    </header>
    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">Trusted workbench access</p>
          <h1>下载工作台，安全接入你的组织。</h1>
          <p class="lead">安装包公开下载，无需登录。首次启动后使用企业账号登录并提交接入申请。</p>
          <a class="button accent" href="#downloads">选择安装包</a>
        </div>
        <div class="trust-card">
          <h2>V0.1 最小可信链</h2>
          <ol>
            <li>企业账号 OIDC + PKCE 登录</li>
            <li>系统管理员或平台管理员审批</li>
            <li>一次性 challenge 与本机密钥证明</li>
            <li>短期机器 Token 与可撤销心跳</li>
          </ol>
        </div>
      </section>
      <section id="downloads" class="downloads">
        <p class="eyebrow">Public downloads</p>
        <h2>下载当前稳定版</h2>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-else-if="packages.length === 0" class="empty">当前没有已发布安装包。</p>
        <div class="package-grid">
          <article v-for="item in packages" :key="item.id" class="package-card">
            <span class="os-mark">{{ osLabel(item.os).slice(0, 3) }}</span>
            <h3>{{ osLabel(item.os) }}</h3>
            <p>{{ item.arch }} · v{{ item.version }}</p>
            <dl>
              <dt>文件</dt><dd>{{ item.file_name }}</dd>
              <dt>大小</dt><dd>{{ sizeLabel(item.size_bytes) }}</dd>
              <dt>SHA-256</dt><dd class="mono" :title="item.sha256">{{ item.sha256 }}</dd>
              <dt>代码签名</dt><dd><span class="badge success">{{ item.signature_status }}</span></dd>
            </dl>
            <a
              class="button primary"
              :href="`/api/v1/public/workbench-packages/${item.id}/download`"
              :download="item.file_name"
            >下载</a>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
