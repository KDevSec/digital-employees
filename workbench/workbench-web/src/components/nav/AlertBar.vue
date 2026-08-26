<script setup lang="ts">
import { computed } from 'vue'

import { alertBanner, interpretPlatformStatus } from '../../api/platform-status'
import { useSessionStore } from '../../stores/session'

/**
 * 平台告警条（I0-5 T10，D-25：告警条独立——TopBar 退役后从其抽出）：
 * 消费 session store 的 accessState → interpretPlatformStatus → alertBanner，仅
 * unreachable（本地服务/代理不可达）与 revoked（实例被平台撤销）两态渲染全宽红条
 * （D-032 提示而非降级：只提示，不锁任何功能；常驻可见性不藏进设置浮层——正常态
 * 零渲染零占位）。组件本身不轮询：数据随 Layout 级 store 流动（更新点 = 守卫首次
 * 导航拉取 + 退出登录动作刷新；TopBar 的 30s 周期刷新随其退役）。
 * 样式从 TopBar 告警条迁移：red-bg 底 / red 字 / 13px / padding 8px 14px / 圆角 10px。
 */
const store = useSessionStore()
const alert = computed(() => alertBanner(interpretPlatformStatus(store.accessState)))
</script>

<template>
  <div v-if="alert" class="alert-bar" role="alert">{{ alert }}</div>
</template>

<style scoped>
/* 全宽红条（TopBar 告警条样式迁移）：main 顶部常驻，margin-bottom 与后续内容区隔开 */
.alert-bar {
  background: var(--red-bg);
  color: var(--red);
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 10px;
  margin-bottom: 14px;
}
</style>
