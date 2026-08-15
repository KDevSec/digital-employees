<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import type { Enrollment, PackageItem, Workbench } from '../../types'

const session = useSessionStore()
const workbenches = ref<Workbench[]>([])
const enrollments = ref<Enrollment[]>([])
const packages = ref<PackageItem[]>([])

onMounted(async () => {
  workbenches.value = await api('/api/v1/workbenches')
  packages.value = await api('/api/v1/public/workbench-packages')
  if (session.can('workbench.enrollment.review')) enrollments.value = await api('/api/v1/workbench-enrollments')
})
</script>

<template>
  <section>
    <div class="page-heading"><div><p class="eyebrow">Overview</p><h1>工作台总览</h1><p>只展示当前角色和数据范围内的信息。</p></div></div>
    <div class="scope-banner"><strong>当前角色</strong><span>{{ session.me?.roles.map((item) => `${item.role_code} / ${item.scope_type}`).join('，') }}</span></div>
    <div class="kpi-grid">
      <article class="kpi"><span>范围内工作台</span><strong>{{ workbenches.length }}</strong></article>
      <article class="kpi"><span>在线工作台</span><strong>{{ workbenches.filter((item) => item.connection_status === 'ONLINE').length }}</strong></article>
      <article class="kpi"><span>待审批接入</span><strong>{{ enrollments.filter((item) => item.status === 'PENDING_REVIEW').length }}</strong></article>
      <article class="kpi"><span>公开安装包</span><strong>{{ packages.length }}</strong></article>
    </div>
    <div class="panel"><h2>可信接入主链</h2><div class="flow"><span>1. OIDC + PKCE</span><span>2. 人工审批</span><span>3. ES256 持钥证明</span><span>4. 机器 Token 心跳</span></div></div>
  </section>
</template>
