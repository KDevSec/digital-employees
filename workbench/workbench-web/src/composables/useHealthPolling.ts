import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import { fetchHealthz, interpretHealth, versionLineGated } from '../api/health'
import type { HealthBadge, HealthzJson } from '../api/health'

/**
 * 服务健康轮询 composable（I0-5 T4，D-11：healthz 消费逻辑统一供接入页与顶栏复用——
 * AccessView 顶部健康徽章与 TopBar 版本行本是同一段 fetchHealthz/interpret/versionLine 逻辑）。
 * 挂载即拉一次 + 每 2s 轮询（Home.vue 退役前的同款节奏，先例语义不动），卸载清理定时器。
 * 调用方在 setup 中取 { badge, version }：接入页消费徽章 + 版本行，顶栏只消费版本行
 * （平台连接状态另有 platform-status 徽章，与本地服务健康是两层判定）。
 */

/** 服务健康轮询间隔（Home.vue/AccessView 先例 2s，I0-5 T4 起顶栏同款） */
const HEALTH_POLL_MS = 2000

export function useHealthPolling(): { badge: Ref<HealthBadge>; version: Ref<string> } {
  const badge = ref<HealthBadge>(interpretHealth(null))
  const version = ref<string>(versionLineGated(null))

  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    const json: HealthzJson | null = await fetchHealthz()
    badge.value = interpretHealth(json)
    // 端口从页面自身地址推导（页面即由服务伺服）；版本行经健康门控防外国占用者 version 误显示
    const port = Number(window.location.port) || undefined
    version.value = versionLineGated(json, port)
  }

  onMounted(() => {
    void refresh()
    timer = setInterval(() => void refresh(), HEALTH_POLL_MS)
  })

  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
  })

  return { badge, version }
}
