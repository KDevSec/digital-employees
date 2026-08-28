<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AccessActions from './AccessActions.vue'
import AccessStatusCard from './AccessStatusCard.vue'
import PlatformConfigCard from './PlatformConfigCard.vue'
import { enrollAction, logoutAction, resetAction } from '../../api/access'
import type { ActionResult } from '../../api/access'
import { useSessionStore } from '../../stores/session'

/**
 * 接入与平台设置弹窗（I0-5 T11，设计 D-26：用户验收反馈「接入与平台设置页面应该是弹窗，
 * 或带侧边栏的页面，而不是单独页面无法返回」——原 RouterLink 跳 '/' 全屏路由（登录卡布局），
 * ACTIVE 用户进入后无侧栏无返回，动线断层）：
 * - 形态：fixed 全屏 mask（原型 modal-mask rgba(15,23,42,.45)）+ 居中白卡（~680px /
 *   max-width 92vw / 原型 modal 阴影 0 24px 60px rgba(15,23,42,.28)），常驻挂载于
 *   Layout（v-model:open 受控沿 SettingsPanel 形态；open=false 时 DOM 零渲染）；
 * - 卡体三件套竖排（弹窗内嵌复用，组件文件零改动）：AccessStatusCard + PlatformConfigCard
 *   + AccessActions——数据流与 AccessView 登录态一致：session store 的 accessState 驱动
 *   （props 直传，弹窗不自拉 /api/state；新鲜度由守卫首拉 + SettingsPanel 30s 周期刷新
 *   + 本弹窗动作后的 fetchState 兜住。accessState null = 服务不可达 → 三件套不渲染，
 *   降级提示行——两内容组件 props 非空约束的守门分支）；
 * - 动作处理（AccessActions emit 交此统一调 api/access.ts）：
 *   · enroll/heartbeat/reset 走 AccessView run() 简版——调动作 → 成功刷 store →
 *     不整页跳转（文案沿 demo messageNode 语义：处理中… / 操作成功 / 服务端错误消息）；
 *   · logout 走 SettingsPanel 同款链路——logoutAction → fetchState → 关 modal →
 *     router.push('/')（退出后守卫按未登录分流回登录卡，D-22 语义）；
 * - 关闭三径（沿 SettingsPanel 手法）：Esc（document keydown 监听，onBeforeUnmount
 *   清理）/ mask 点击（event.target === mask 判定，点卡内冒泡不关——原型 modal
 *   onclick 同语义）/ 卡头 X 钮；关闭即回原业务页（URL 不动，上下文不丢——D-26
 *   动线修复核心）；
 * - '/' 路由语义随 D-26 收窄为「未登录登录卡 + 审批中盯进度全屏页」，ACTIVE 用户不再
 *   被引去（设置浮层第三项 RouterLink 退役改 button emit，见 SettingsPanel/Layout）。
 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const store = useSessionStore()
const router = useRouter()

/** store 驱动（弹窗不自拉：守卫首拉 + 面板 30s 轮询 + 动作后刷新三源供流） */
const state = computed(() => store.accessState)

/** 动作文案区（demo messageNode 语义：处理中… / 操作成功 / 服务端错误消息） */
const message = ref('')

/** mask 根（外点关闭的 target===mask 判定基准） */
const maskRef = ref<HTMLElement | null>(null)

/** 关闭弹窗（v-model:open 归 Layout 持有） */
function close(): void {
  emit('update:open', false)
}

/** mask 点击关闭：target 是 mask 自身（卡外）才关，点卡内冒泡到此不关（原型 modal onclick 语义） */
function onMaskClick(event: MouseEvent): void {
  if (event.target === maskRef.value) close()
}

/** Esc 关闭弹窗 */
function onDocKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') close()
}

/** 动作统一入口（AccessView run() 简版）：处理中… → 结果文案；成功后刷 store（不整页跳转） */
async function run(action: () => Promise<ActionResult>): Promise<void> {
  message.value = '处理中…'
  const result = await action()
  message.value = result.message
  if (result.ok) await store.fetchState()
}

function onEnroll(): void {
  void run(enrollAction)
}

function onReset(): void {
  void run(resetAction)
}

/** 退出登录（D-26；026 对齐 AccessView 023 逻辑）：
 * 服务端返回 oidcLogoutUrl 时整页跳转 Keycloak end_session 结束 SSO（否则再点登录免密）；
 * 无 URL（发现失败降级/开发态）才走 fetchState → 关 modal → 回 '/' 的本地登出链路。 */
async function onLogout(): Promise<void> {
  const result = await logoutAction()
  if (result.oidcLogoutUrl) {
    window.location.href = result.oidcLogoutUrl
    return
  }
  await store.fetchState()
  close()
  await router.push('/')
}

/** 弹窗收起时清空动作文案（下次打开不留旧反馈） */
watch(
  () => props.open,
  (open) => {
    if (!open) message.value = ''
  },
)

onMounted(() => {
  document.addEventListener('keydown', onDocKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <!-- D-26：弹窗 DOM 仅 open 时存在（正常态零占位）；mask 即外点关闭热区（target===mask 判定） -->
  <div v-if="open" ref="maskRef" class="access-modal-mask" @click="onMaskClick">
    <div class="access-modal" role="dialog" aria-modal="true" aria-label="接入与平台设置">
      <div class="modal-head">
        <strong class="modal-title">接入与平台设置</strong>
        <button type="button" class="modal-close" aria-label="关闭" @click="close">✕</button>
      </div>
      <div class="modal-body">
        <template v-if="state">
          <!-- 三件套竖排（组件零改动复用；数据源 = store.accessState props 直传） -->
          <section class="section-card">
            <h2>接入状态</h2>
            <AccessStatusCard :state="state" />
          </section>
          <PlatformConfigCard />
          <AccessActions
            :state="state"
            @enroll="onEnroll"
            @reset="onReset"
            @logout="onLogout"
          />
          <p v-if="message" class="muted">{{ message }}</p>
        </template>
        <!-- store null（服务不可达）→ 降级提示行（三件套 props 非空，不硬渲染） -->
        <p v-else class="muted">服务不可达，无法获取接入状态</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原型 .modal-mask：fixed 全屏遮罩 + flex 居中；z-index 50（高于设置浮层 30 与侧栏 20） */
.access-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px; /* 窄屏下卡不贴屏边（配合 max-width 92vw） */
}

/* 原型 .modal × .card 语言：白卡 ~680px / 圆角 16 / g200 边框 / modal 阴影；纵向列布局 */
.access-modal {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 16px;
  width: 680px;
  max-width: 92vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

/* 原型 .modal-head：标题行 + 底部 g100 分隔线 */
.modal-head {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--g100);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

/* 原型 modal 头标题语言：16px 加粗 */
.modal-title {
  font-size: 16px;
  font-weight: 700;
}

/* 原型 .modal-close：28px 方钮 g100 底 / g600 字 / hover g200 */
.modal-close {
  border: none;
  background: var(--g100);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--g600);
  font-size: 13px;
  flex-shrink: 0;
  line-height: 1;
}

.modal-close:hover {
  background: var(--g200);
  color: var(--ink);
}

/* 原型 .modal-body：纵向堆叠三件套（gap 统一间距）；超高滚动（max-height 82vh 兜底） */
.modal-body {
  padding: 16px 22px 20px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 状态卡：AccessView 状态卡同款 .card 子集 + section-title 标题（蓝竖条 15px 600） */
.section-card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 18px 20px;
}

.section-card h2 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-card h2::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: var(--blue-500);
}

/* 配置卡在弹窗内撑满卡宽：组件自带 360px 是接入页 hero 侧挂语境，弹窗内等宽对齐状态卡；
   动作组 margin-top 18px 是接入页卡内语境，弹窗 flex gap 统一间距归零——两处均父层组合
   调整（组件文件零改动，D-26 复用约束） */
.modal-body :deep(.platform-card) {
  width: 100%;
  flex-shrink: 1;
}

.modal-body :deep(.actions) {
  margin-top: 0;
}

/* 动作文案区（demo messageNode 语义：处理中… / 操作成功 / 服务端错误消息） */
.muted {
  color: var(--g500);
  font-size: 13px;
  margin: 0;
}
</style>
