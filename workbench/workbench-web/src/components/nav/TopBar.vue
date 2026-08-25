<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useHealthPolling } from '../../composables/useHealthPolling'
import { alertBanner, interpretPlatformStatus, statusBadge } from '../../api/platform-status'
import { useSessionStore } from '../../stores/session'

/**
 * 顶栏全局态（I0-5 T4，F-04 顶栏数据源，设计 §3 尾段）：
 * - 用户区：首字母圆徽（name ?? preferred_username 首字符）+ name/email 两行文本；
 *   无用户或展示性 claim 全缺 → 「未登录」灰态（数据来自 session store 的 accessState.user）；
 * - 平台状态徽章 + 告警条：interpretPlatformStatus 消费 store.accessState——ok 绿 /
 *   stale 黄不出告警 / inactive 灰中性 / revoked·unreachable 红且告警条常驻顶栏下沿
 *   （D-032 提示而非降级：只提示，不锁任何功能）；
 * - 版本行：useHealthPolling（fetchHealthz + versionLineGated，2s 轮询，接入页同款）；
 * - 检查更新：占位按钮（U 系列未落地）——点击只弹提示条「检查更新功能即将上线」，
 *   不发起任何网络请求；
 * - /api/state 轮询：每 30s 经 session store fetchState 刷新（复用守卫同一动作，
 *   loaded 门闩只拦守卫首次导航，轮询更新 accessState 不影响守卫判定路径）。
 *   挂载不立即拉取——TopBar 仅在 Layout 内挂载，守卫首次导航必已拉过一次
 *   （guard-integration「/api/state 只拉一次」断言依赖此约定，立即拉取会与之重复）。
 */

/** /api/state 轮询间隔：A-05 服务端心跳 60s 未落地前的前端观察节奏（A 系列落地后对齐） */
const ACCESS_STATE_POLL_MS = 30_000

const store = useSessionStore()
const { version } = useHealthPolling()

const user = computed(() => store.accessState?.user)
/** 展示名兜底链：name → preferred_username → email（末者兼任名行时不重复渲染 email 行） */
const displayName = computed(() => user.value?.name ?? user.value?.preferred_username ?? user.value?.email ?? '')
/** 无用户或三个展示性 claim 全缺 → 未登录灰态（无内容可展示，不臆造占位名） */
const isGuest = computed(() => displayName.value === '')
const initial = computed(() => displayName.value.charAt(0))
/** email 行：仅当 email 存在且未被名行兜底占用时渲染 */
const emailLine = computed(() => {
  const email = user.value?.email
  return email && email !== displayName.value ? email : null
})

const platformStatus = computed(() => interpretPlatformStatus(store.accessState))
const badge = computed(() => statusBadge(platformStatus.value))
const alert = computed(() => alertBanner(platformStatus.value))

/** 检查更新占位提示条（U 系列未落地，占位语义——见组件头注释） */
const updateNotice = ref(false)

let stateTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  // 不立即 fetchState（守卫首次拉取的错开约定见组件头注释），只起周期刷新
  stateTimer = setInterval(() => void store.fetchState(), ACCESS_STATE_POLL_MS)
})

onBeforeUnmount(() => {
  if (stateTimer !== undefined) clearInterval(stateTimer)
})
</script>

<template>
  <header class="topbar">
    <div class="row">
      <div class="user" :class="{ guest: isGuest }">
        <template v-if="!isGuest">
          <span class="avatar" aria-hidden="true">{{ initial }}</span>
          <span class="user-text">
            <span class="name">{{ displayName }}</span>
            <small v-if="emailLine" class="email">{{ emailLine }}</small>
          </span>
        </template>
        <span v-else class="guest-label">未登录</span>
      </div>
      <div class="meta">
        <span class="platform-badge" :class="badge.badgeClass">{{ badge.label }}</span>
        <span class="version">{{ version }}</span>
        <button type="button" class="check-update" @click="updateNotice = true">检查更新</button>
      </div>
    </div>
    <!-- 告警条：仅 unreachable/revoked 渲染（D-032 提示而非降级） -->
    <div v-if="alert" class="alert" role="alert">{{ alert }}</div>
    <!-- 检查更新占位提示条（U 系列未落地） -->
    <div v-if="updateNotice" class="update-notice">检查更新功能即将上线</div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-bottom: 1px solid #dce7e2;
}

.row {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  gap: 16px;
}

.user {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #c9f56d;
  color: #113b34;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
}

.user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.user-text .name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-text .email {
  color: #60716d;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 未登录灰态（无用户/无展示性 claim） */
.user.guest .guest-label {
  color: #8a9b96;
}

.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.platform-badge {
  padding: 3px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 700;
}

.platform-badge.ok {
  background: #dcf5ec;
  color: #08775b;
}

.platform-badge.warn {
  background: #fdf3d7;
  color: #8a6d1a;
}

.platform-badge.error {
  background: #ffe7ea;
  color: #ad2635;
}

.platform-badge.neutral {
  background: #e8eeeb;
  color: #60716d;
}

.version {
  color: #60716d;
  font-size: 12px;
}

.check-update {
  border: 1px solid #dce7e2;
  background: #fff;
  color: #20302c;
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}

.check-update:hover {
  border-color: #65b89c;
  color: #08775b;
}

/* 告警条：常驻顶栏下沿红色横条（仅 unreachable/revoked） */
.alert {
  background: #ad2635;
  color: #fff;
  padding: 6px 24px;
  font-size: 13px;
}

/* 检查更新占位提示条 */
.update-notice {
  background: #fdf3d7;
  color: #8a6d1a;
  padding: 6px 24px;
  font-size: 13px;
}
</style>
