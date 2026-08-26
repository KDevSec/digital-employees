<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { logoutAction } from '../../api/access'
import { useHealthPolling } from '../../composables/useHealthPolling'
import { interpretPlatformStatus, statusBadge } from '../../api/platform-status'
import { useSessionStore } from '../../stores/session'

/**
 * 设置浮层（I0-5 T10，D-24：TopBar 退役，内容全迁此——用户验收指令「Test User/邮箱/
 * 平台已连接/版本/检查更新——第一行这些内容都放到左下角的设置按钮里」）：
 * - 形态：从侧栏底部**向上弹出**的固定定位浮层（left:78px 侧栏右侧 / bottom:16px /
 *   280px 白卡，原型 .card 语言），常驻挂载于 Layout（v-model:open 受控：open=false
 *   时浮层 DOM 零渲染）；
 * - 三分组（组间 g100 分隔线，D-24）：
 *   ① 用户组：首字母圆徽（.avatar .av-blue）+ name/email 两行；无用户或展示性 claim
 *      全缺 → 「未登录」灰态（数据来自 session store 的 accessState.user）；
 *   ② 状态组：平台状态 tag（interpretPlatformStatus 消费 store.accessState——语义类
 *      → 原型 tag 体系映射 ok→tag-green/stale→tag-amber/revoked·unreachable→tag-red/
 *      inactive→tag-gray，附 dot 小圆点）+ 版本行（useHealthPolling 数据源迁此）；
 *   ③ 动作组：「检查更新」占位（U 系列未落地，点击只弹提示「检查更新功能即将上线」，
 *      不发起任何网络请求）+「接入与平台设置」（RouterLink 跳 '/'，接入页承载状态与
 *      平台配置）+「退出登录」红字（logoutAction → store.fetchState → 编程导航回 '/'，
 *      退出后 fetchState 拿到未登录态，守卫与登录卡自然衔接——D-22 语义迁移）；
 * - 开关（沿 T9 TopBar 下拉手法）：外点（document 冒泡 + contains 判定「点浮层内部不关」）
 *   / Esc 关闭（emit update:open false），document 监听 onBeforeUnmount 清理。SideNav
 *   齿轮的点击经 .stop 阻断冒泡（开浮层的这一次点击不会被外点判定误关）；
 * - useHealthPolling 迁入：浮层组件挂载起轮询（healthz 2s，打开时数据新鲜），卸载清理；
 *   /api/state 30s 周期刷新（T10 单审裁决恢复：TopBar 退役时周期刷新被一并移除会冻结
 *   AlertBar 告警态新鲜度——D-032「运行中平台不可达→常驻告警」要求运行中可见；面板
 *   常驻挂载故轮询常开，A-05 服务端心跳落地后对齐节奏）；
 * - 常驻挂载 + 浮层 v-if 的分工：Layout 生命周期内轮询常开（版本行随时新鲜），浮层 DOM
 *   仅 open 时存在（正常态零占位）。完整设置中心留 S-07 落地时升级。
 */

/** /api/state 周期刷新间隔（T10 单审恢复；A-05 服务端心跳 60s 落地后对齐——T4 先例注释） */
const ACCESS_STATE_POLL_MS = 30_000

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const store = useSessionStore()
const router = useRouter()
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

/**
 * 徽章语义类（ok/warn/error/neutral）→ 原型 tag/dot 类的纯视觉映射（T7 组件层完成——
 * platform-status 纯函数返回形状不变，platform-status.test 锚定语义类；语义类同时保留在
 * DOM 上，settings-panel.test 的 classes 断言沿 top-bar.test 先例）。
 */
const TAG_BY_BADGE_CLASS = { ok: 'tag-green', warn: 'tag-amber', error: 'tag-red', neutral: 'tag-gray' } as const
const DOT_BY_BADGE_CLASS = { ok: 'dot-green', warn: 'dot-amber', error: 'dot-red', neutral: 'dot-gray' } as const
const badgeTagClass = computed(() => TAG_BY_BADGE_CLASS[badge.value.badgeClass])
const badgeDotClass = computed(() => DOT_BY_BADGE_CLASS[badge.value.badgeClass])

/** 检查更新占位提示条（U 系列未落地，占位语义——见组件头注释）；浮层收起时重置 */
const updateNotice = ref(false)

/** 浮层根（v-if 同体）：外点判定的 contains 基准 */
const panelRef = ref<HTMLElement | null>(null)

/** 收起浮层（v-model:open 归 Layout 持有） */
function close(): void {
  emit('update:open', false)
}

/** 浮层外点击关闭：target 不在浮层内 → 收起（手写 document 监听，onBeforeUnmount 清理） */
function onDocClick(event: MouseEvent): void {
  if (!props.open) return
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    close()
  }
}

/** Esc 关闭浮层 */
function onDocKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') {
    close()
  }
}

/**
 * 退出登录（D-22 语义迁移）：logoutAction → 刷新 store（拿到未登录态）→ 编程导航回 '/'。
 * 退出后守卫按未登录分流（无 ACTIVE 自动跳），登录卡/接入页自然衔接。
 */
async function onLogout(): Promise<void> {
  close()
  await logoutAction()
  await store.fetchState()
  await router.push('/')
}

let stateTimer: ReturnType<typeof setInterval> | undefined

watch(
  () => props.open,
  (open) => {
    if (!open) updateNotice.value = false
  },
)

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeydown)
  // /api/state 30s 周期刷新（T10 单审裁决恢复，D-032 运行中告警新鲜度——头注释）：面板常驻挂载，
  // 轮询随组件生命周期常开（AlertBar 同源消费 store，运行中平台断联 30s 内翻红）
  stateTimer = setInterval(() => void store.fetchState(), ACCESS_STATE_POLL_MS)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown)
  if (stateTimer !== undefined) clearInterval(stateTimer)
})
</script>

<template>
  <!-- D-24：浮层 DOM 仅 open 时存在（正常态零占位）；固定定位从侧栏底部向上弹出 -->
  <div v-if="open" ref="panelRef" class="settings-panel" role="dialog" aria-label="设置">
    <!-- ① 用户组（TopBar 用户区迁入） -->
    <div class="panel-group user-group" :class="{ guest: isGuest }">
      <template v-if="!isGuest">
        <span class="avatar av-blue" aria-hidden="true">{{ initial }}</span>
        <span class="user-text">
          <span class="name">{{ displayName }}</span>
          <small v-if="emailLine" class="email">{{ emailLine }}</small>
        </span>
      </template>
      <span v-else class="guest-label">未登录</span>
    </div>
    <!-- ② 状态组（平台状态 tag + 版本行——useHealthPolling 数据源迁此） -->
    <div class="panel-group status-group">
      <span class="platform-badge" :class="[badgeTagClass, badge.badgeClass]">
        <span class="dot" :class="badgeDotClass" aria-hidden="true"></span>{{ badge.label }}
      </span>
      <span class="version">{{ version }}</span>
    </div>
    <!-- ③ 动作组（检查更新占位 / 接入与平台设置 / 退出登录——D-22 语义迁移） -->
    <div class="panel-group action-group">
      <button type="button" class="action-item" @click="updateNotice = true">检查更新</button>
      <RouterLink to="/" class="action-item" @click="close">接入与平台设置</RouterLink>
      <button type="button" class="action-item action-danger" @click="onLogout">退出登录</button>
    </div>
    <!-- 检查更新占位提示条（U 系列未落地） -->
    <div v-if="updateNotice" class="update-notice">检查更新功能即将上线</div>
  </div>
</template>

<style scoped>
/* D-24 浮层定位：侧栏（78px）右侧贴边 + 底部锚定向上弹出（原型无此形态，按 token 延展） */
.settings-panel {
  position: fixed;
  left: 78px;
  bottom: 16px;
  width: 280px;
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(30, 64, 175, 0.12);
  z-index: 30; /* 高于侧栏（z-index:20）与内容区 */
}

/* 三分组通用内边距 + 组间 g100 分隔线 */
.panel-group {
  padding: 12px 16px;
}

.panel-group + .panel-group {
  border-top: 1px solid var(--g100);
}

/* ① 用户组：圆徽 + 两行文本（TopBar .user 区样式迁移） */
.user-group {
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
.user-group.guest .guest-label {
  color: var(--g500);
  font-size: 13px;
}

/* ② 状态组：平台状态 tag + 版本行竖排（窄浮层内单列，避免横向溢出） */
.status-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

/* 平台状态徽章：原型 .tag 语言（pill）+ 语义类保留（沿 top-bar.test 断言先例） */
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

/* 原型 .dot 语言：7px 小圆点（徽章内指示） */
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

/* ③ 动作组：整块可点菜单项（TopBar settings-menu .menu-item 样式迁移，竖排满宽） */
.action-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
}

.action-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  color: var(--g700);
  cursor: pointer;
  text-decoration: none;
  transition: 0.15s;
  font-family: inherit;
}

.action-item:hover {
  background: var(--blue-50);
  color: var(--blue-700);
}

/* 退出登录：红字变体（沿 AccessActions btn-danger / TopBar menu-item-danger 语言） */
.action-danger {
  color: var(--red);
}

.action-danger:hover {
  background: var(--red-bg);
  color: var(--red);
}

/* 检查更新占位提示条：blue-50 信息条（TopBar update-notice 样式迁移，内嵌浮层底部） */
.update-notice {
  margin: 0 16px 12px;
  padding: 8px 10px;
  background: var(--blue-50);
  color: var(--blue-800);
  font-size: 12.5px;
  border-radius: 8px;
}
</style>
