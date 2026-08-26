<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useHealthPolling } from '../../composables/useHealthPolling'
import { alertBanner, interpretPlatformStatus, statusBadge } from '../../api/platform-status'
import { useSessionStore } from '../../stores/session'

/**
 * 顶栏全局态（I0-5 T4，F-04 顶栏数据源，设计 §3 尾段；T7 视觉对齐原型）：
 * - 形态：main 顶部一条白卡片（原型 .card 语言），内部 flex 两端布局——左侧用户区
 *   （原型 .avatar .av-blue 40px 蓝渐变圆徽 + name/email 两行），右侧平台状态徽章
 *   （原型 tag 体系：ok→tag-green/stale→tag-amber/revoked·unreachable→tag-red/
 *   inactive→tag-gray，附 dot 小圆点）+ 版本行 + 检查更新按钮（.btn .btn-ghost .btn-sm）；
 * - 用户区：首字母圆徽（name ?? preferred_username 首字符）+ name/email 两行文本；
 *   无用户或展示性 claim 全缺 → 「未登录」灰态（数据来自 session store 的 accessState.user）；
 * - 平台状态徽章 + 告警条：interpretPlatformStatus 消费 store.accessState——ok 绿 /
 *   stale 黄不出告警 / inactive 灰中性 / revoked·unreachable 红且告警条常驻卡片下方
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

/**
 * 徽章语义类（ok/warn/error/neutral）→ 原型 tag/dot 类的纯视觉映射（T7 组件层完成——
 * platform-status 纯函数返回形状不变，platform-status.test 锚定语义类；语义类同时保留在
 * DOM 上，top-bar.test 的 classes 断言不受影响）。
 */
const TAG_BY_BADGE_CLASS = { ok: 'tag-green', warn: 'tag-amber', error: 'tag-red', neutral: 'tag-gray' } as const
const DOT_BY_BADGE_CLASS = { ok: 'dot-green', warn: 'dot-amber', error: 'dot-red', neutral: 'dot-gray' } as const
const badgeTagClass = computed(() => TAG_BY_BADGE_CLASS[badge.value.badgeClass])
const badgeDotClass = computed(() => DOT_BY_BADGE_CLASS[badge.value.badgeClass])

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
    <div class="topbar-card">
      <div class="row">
        <div class="user" :class="{ guest: isGuest }">
          <template v-if="!isGuest">
            <span class="avatar av-blue" aria-hidden="true">{{ initial }}</span>
            <span class="user-text">
              <span class="name">{{ displayName }}</span>
              <small v-if="emailLine" class="email">{{ emailLine }}</small>
            </span>
          </template>
          <span v-else class="guest-label">未登录</span>
        </div>
        <div class="meta">
          <span class="platform-badge" :class="[badgeTagClass, badge.badgeClass]">
            <span class="dot" :class="badgeDotClass" aria-hidden="true"></span>{{ badge.label }}
          </span>
          <span class="version">{{ version }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="updateNotice = true">检查更新</button>
        </div>
      </div>
    </div>
    <!-- 告警条：卡片下方全宽条，仅 unreachable/revoked 渲染（D-032 提示而非降级） -->
    <div v-if="alert" class="alert" role="alert">{{ alert }}</div>
    <!-- 检查更新占位提示条（U 系列未落地） -->
    <div v-if="updateNotice" class="update-notice">检查更新功能即将上线</div>
  </header>
</template>

<style scoped>
/* 卡片在 main 顶部，与后续内容区间距（原型 .page-head margin-bottom 同值） */
.topbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 18px;
}

/* 原型 .card 语言：白底 / g200 边框 / 14px 圆角 / 浅蓝墨投影 */
.topbar-card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  flex-wrap: wrap;
}

.user {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 原型 .avatar .av-blue：40px 蓝渐变圆徽 + 首字母白字 */
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 15px;
  color: #fff;
  flex-shrink: 0;
}

.av-blue {
  background: linear-gradient(135deg, var(--blue-600), var(--blue-400));
}

.user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.user-text .name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-text .email {
  color: var(--g500);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 未登录灰态（无用户/无展示性 claim） */
.user.guest .guest-label {
  color: var(--g500);
}

.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* 平台状态徽章：原型 .tag 语言（pill）+ 语义类保留（top-bar.test 断言） */
.platform-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.tag-green {
  background: var(--green-bg);
  color: var(--green);
}

.tag-amber {
  background: var(--amber-bg);
  color: var(--amber);
}

.tag-red {
  background: var(--red-bg);
  color: var(--red);
}

.tag-gray {
  background: var(--g100);
  color: var(--g600);
}

/* 原型 .dot 语言：7px 小圆点（env-pill 徽章内指示） */
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.dot-green {
  background: var(--green);
}

.dot-amber {
  background: #f59e0b;
}

.dot-red {
  background: var(--red);
}

.dot-gray {
  background: var(--g400);
}

.version {
  color: var(--g500);
  font-size: 12px;
}

/* 原型 .btn .btn-ghost .btn-sm 语言 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  font-weight: 500;
}

.btn-ghost {
  background: #fff;
  border-color: var(--g300);
  color: var(--g700);
}

.btn-ghost:hover {
  border-color: var(--blue-400);
  color: var(--blue-700);
}

.btn-sm {
  padding: 5px 11px;
  font-size: 12px;
  border-radius: 7px;
}

/* 告警条：卡片下方全宽条（red-bg 底/red 字/13px/上下 padding 8px/圆角 10px），仅 unreachable/revoked */
.alert {
  background: var(--red-bg);
  color: var(--red);
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 10px;
}

/* 检查更新占位提示条：blue-50 信息条（同告警条形态） */
.update-notice {
  background: var(--blue-50);
  color: var(--blue-800);
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 10px;
}
</style>
