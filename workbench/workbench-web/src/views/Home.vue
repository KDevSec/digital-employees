<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchHealthz, interpretHealth, versionLineGated } from '../api/health'
import type { HealthBadge, HealthzJson } from '../api/health'

/** 轮询间隔（计划文档 Task 10：健康徽章 2s 轮询 fetchHealthz → interpretHealth 渲染） */
const POLL_MS = 2000

const badge = ref<HealthBadge>(interpretHealth(null))
const version = ref<string>(versionLineGated(null))
let timer: ReturnType<typeof setInterval> | undefined

async function refresh(): Promise<void> {
  const json: HealthzJson | null = await fetchHealthz()
  badge.value = interpretHealth(json)
  // 端口从页面自身地址推导（页面即由服务伺服）；无端口（默认 80）时不展示端口段。
  // 版本行经健康门控：外国占用者带 version 也不显示
  const port = Number(window.location.port) || undefined
  version.value = versionLineGated(json, port)
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), POLL_MS)
})

onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
  <main class="home">
    <h1 class="title">DevZero</h1>
    <p class="badge" :class="badge.badgeClass">{{ badge.badge }}</p>
    <p class="version">{{ version }}</p>
    <p class="note">V0.1 框架增量 · 业务填充中</p>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  background: #f6f7f9;
  color: #1f2328;
  margin: 0;
}

.title {
  font-size: 28px;
  font-weight: 600;
  margin: 0;
}

.badge {
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 14px;
  margin: 0;
}

.badge.ok {
  background: #e6f4ea;
  color: #1a7f37;
}

.badge.down {
  background: #fdebe9;
  color: #c0392b;
}

.version {
  font-size: 14px;
  color: #57606a;
  margin: 0;
}

.note {
  font-size: 13px;
  color: #8b949e;
  margin: 0;
}
</style>
