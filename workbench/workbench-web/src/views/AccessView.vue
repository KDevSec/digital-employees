<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AccessActions from '../components/access/AccessActions.vue'
import PlatformConfigCard from '../components/access/PlatformConfigCard.vue'
import {
  enrollAction,
  fetchAccessState,
  logoutAction,
  progressAction,
  resetAction,
} from '../api/access'
import type { AccessState, ActionResult } from '../api/access'

/**
 * 登录与接入页（024 极简重构）：
 * - 未登录 = 居中单卡登录页：品牌 logo + 名称 + 「登录」主按钮 + 卡底「平台设置 ▾」
 *   （仅平台地址配置；TLS 开关不再暴露）。说明性文案与服务状态小字全部移除；
 * - 已登录未激活 = 居中等待卡：仅「等待审批」类字样 + 拒绝原因 + 必要操作
 *   （重新提交/重置/退出登录）。不展示任何终端标识/元数据/心跳信息——
 *   避免终端使用者感知平台收集的信息（024 用户裁决）；
 * - ACTIVE 不落地：轮询/刷新拿到 ACTIVE 即 router.push('/employees')（023）；
 * - 审批中每 5s POST /api/progress + 刷新（onUnmounted/条件退出 clearInterval）。
 */

/** 审批进度轮询间隔（demo ui.ts L31 的 5s） */
const PROGRESS_POLL_MS = 5000

const state = ref<AccessState | null>(null)
/** 首次拉取失败（fetchAccessState 归一 null）→ 不可达文案；后续刷新失败保留旧状态卡 */
const loadFailed = ref(false)
/** 动作文案区（demo messageNode：处理中… / 操作成功 / 服务端错误消息） */
const message = ref('')
/** 登录卡「平台设置 ▾」折叠区开合（D-19：T8 配置卡收纳进登录卡） */
const configOpen = ref(false)
const router = useRouter()

/** 双形态分流：authenticated 才进等待卡；未登录/不可达（state null）一律登录卡 */
const isLoggedIn = computed(() => state.value?.authenticated === true)

/** 等待卡标题/说明（仅审批相关字样，不暴露任何终端元数据） */
const pendingCopy = computed<{ title: string; detail: string }>(() => {
  const status = state.value?.status
  if (status === 'REJECTED') {
    return { title: '接入申请未通过', detail: '管理员已拒绝本次接入申请，可修改后重新提交。' }
  }
  if (status === 'ERROR') {
    return { title: '接入申请提交失败', detail: '提交过程中出现错误，可重新提交接入申请。' }
  }
  if (status === 'NEW') {
    return { title: '正在提交接入申请', detail: '接入申请提交后需管理员审批，请稍候。' }
  }
  return { title: '接入申请审批中', detail: '您的接入申请已提交，等待管理员审批；审批通过后将自动进入工作台。' }
})

let progressTimer: ReturnType<typeof setInterval> | undefined

async function refresh(): Promise<void> {
  const next = await fetchAccessState()
  if (next) {
    const wasActive = state.value?.status === 'ACTIVE'
    state.value = next
    loadFailed.value = false
    // 023：审批通过后轮询拿到 ACTIVE（此前非 ACTIVE）→ 自动进入终端工作台
    if (!wasActive && next.authenticated && next.status === 'ACTIVE') {
      void router.push('/employees')
    }
  } else {
    loadFailed.value = true
  }
  syncProgressPolling()
}

/** demo L31 语义：authenticated 且 PENDING_REVIEW/APPROVED 才轮询；条件退出即 clearInterval */
function syncProgressPolling(): void {
  if (progressTimer !== undefined) {
    clearInterval(progressTimer)
    progressTimer = undefined
  }
  const current = state.value
  if (current?.authenticated && ['PENDING_REVIEW', 'APPROVED'].includes(current.status)) {
    progressTimer = setInterval(() => void pollProgress(), PROGRESS_POLL_MS)
  }
}

async function pollProgress(): Promise<void> {
  const result = await progressAction()
  if (result.ok) {
    await refresh()
  } else {
    message.value = result.message
  }
}

/** 动作统一入口：处理中… → 结果文案；成功后重拉状态（demo call() + 各按钮 handler 语义） */
async function run(action: () => Promise<ActionResult>): Promise<void> {
  message.value = '处理中…'
  const result = await action()
  message.value = result.message
  if (result.ok) await refresh()
}

function onEnroll(): void {
  void run(enrollAction)
}

function onReset(): void {
  void run(resetAction)
}

// 023：退出登录——服务端清本地会话并返回 Keycloak end_session URL；
// 有 URL 则整页跳转结束 Keycloak SSO（下次登录需重新输入账号密码），否则回退刷新本地态。
async function onLogout(): Promise<void> {
  message.value = '处理中…'
  const result = await logoutAction()
  if (result.oidcLogoutUrl) {
    window.location.href = result.oidcLogoutUrl
    return
  }
  message.value = result.message
  if (result.ok) await refresh()
}

/**
 * 登录卡主按钮：OIDC 出站 302 必须整页跳转（与 AccessActions 登录按钮同语义——
 * 那边是组件契约保留，本页未登录形态的入口已移到登录卡，AccessActions 的登录按钮
 * 不再经本页渲染）。
 */
function login(): void {
  window.location.href = '/auth/login'
}

onMounted(() => {
  void refresh()
})

onBeforeUnmount(() => {
  if (progressTimer !== undefined) clearInterval(progressTimer)
})
</script>

<template>
  <div class="access-page login-mode">
    <!-- 已登录未激活（024 极简）：居中等待卡——仅审批相关字样 + 必要操作，不暴露任何终端元数据 -->
    <main v-if="isLoggedIn" class="login-wrap">
      <section class="card login-card">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
        </div>
        <h1 class="brand-name">{{ pendingCopy.title }}</h1>
        <p class="lead">{{ pendingCopy.detail }}</p>
        <p v-if="state?.rejectionReason" class="reason">拒绝原因：{{ state.rejectionReason }}</p>
        <AccessActions
          :state="state"
          @enroll="onEnroll"
          @reset="onReset"
          @logout="onLogout"
        />
        <p v-if="message" class="action-message">{{ message }}</p>
      </section>
    </main>

    <!-- 未登录形态：居中单卡登录页（D-19）——登录卡自带品牌，头部条移除 -->
    <main v-else class="login-wrap">
      <section class="card login-card">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
        </div>
        <h1 class="brand-name">研发零处数字员工终端</h1>
        <!-- 整宽放大主按钮（btn-primary：padding 12px / 字号 15px / 整宽） -->
        <button type="button" class="btn btn-primary btn-login" @click="login">登录</button>
        <!-- 首次拉取失败 → 卡内不可达提示（登录卡骨架仍在，不白屏） -->
        <p v-if="loadFailed" class="error">服务不可达，无法获取接入状态</p>
        <!-- 「平台设置 ▾」折叠区（D-19：T8 配置卡收纳进登录卡） -->
        <div v-if="configOpen" class="config-drawer">
          <PlatformConfigCard />
        </div>
        <!-- 卡底：仅「平台设置 ▾」入口（024：服务状态/版本等说明性信息移除） -->
        <div class="card-foot">
          <button type="button" class="config-toggle" @click="configOpen = !configOpen">平台设置 ▾</button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* T7 蓝系：body 基调（--bg/--ink/字体栈）由全局 tokens.css 提供。
   T9（D-19）背景装饰：--bg 底 + 左上/右下两团蓝渐变 radial 光斑（纯 CSS 无资源），
   登录卡形态与状态页形态共用；login-mode 附加垂直水平居中（登录卡）。 */
.access-page {
  min-height: 100vh;
  background:
    radial-gradient(600px 400px at 15% 10%, rgba(59, 130, 246, 0.12), transparent),
    radial-gradient(600px 400px at 85% 90%, rgba(96, 165, 250, 0.1), transparent),
    var(--bg);
}

.access-page.login-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* ---- 已登录形态（D-20 简化状态页，骨架沿用 T7） ---- */

/* 头部品牌条：沿侧栏渐变语言（横向 blue-950→blue-800）+ logo 方块（同 SideNav logo） */
.head {
  background: linear-gradient(90deg, var(--blue-950), var(--blue-800));
  color: #fff;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 0 34px;
}

.logo {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: linear-gradient(135deg, var(--blue-500), var(--blue-400));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.45);
  flex-shrink: 0;
}

.logo svg {
  width: 26px;
  height: 26px;
}

.brand {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.brand strong {
  font-size: 15px;
  font-weight: 600;
}

.brand small {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

/* 健康徽章区：tag 体系（自带浅底可读）+ 版本行白字 70% 透明度 */
.health {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.health .version {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.tag {
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

.tag-red {
  background: var(--red-bg);
  color: var(--red);
}

.page {
  max-width: 1040px;
  margin: 0 auto;
  padding: 26px 34px 60px;
}

/* hero 简化为一行（D-20）：h1 与 sub 同行 baseline 对齐（eyebrow 已删） */
.hero {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.sub {
  color: var(--g500);
  margin: 0;
  font-size: 13px;
}

/* D-20：状态卡主位 + 配置卡次位——grid 单列（简洁优先，配置卡随行在下方） */
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

/* 原型 .card 语言 + 卡内标题走 section-title 语言（蓝竖条 + 15px 600） */
.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.card h2 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card h2::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: var(--blue-500);
}

.muted {
  color: var(--g500);
  font-size: 13px;
  margin-top: 12px;
}

.error {
  color: var(--red);
}

/* ---- 未登录形态：登录卡（D-19） ---- */

.login-wrap {
  width: 100%;
  display: flex;
  justify-content: center;
}

.login-card {
  width: 400px;
  max-width: 100%;
  padding: 32px 30px 20px;
  text-align: center;
}

/* 登录卡 logo：同 SideNav 款 44px 蓝渐变方块 + 人形 SVG（居中放大留白） */
.login-card .logo {
  margin: 0 auto 18px;
}

.brand-name {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.brand-sub {
  margin-top: 5px;
  font-size: 13px;
  color: var(--g500);
}

.lead {
  margin-top: 16px;
  font-size: 13px;
  color: var(--g500);
}

/* 原型 .btn/.btn-primary 语言（同 AccessActions 子集） */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  font-weight: 500;
}

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:hover {
  background: var(--blue-700);
}

/* 整宽放大主按钮（D-19：padding 12px / 字号 15px / 整宽） */
.btn-login {
  margin-top: 24px;
  width: 100%;
  padding: 12px;
  font-size: 15px;
}

.login-card .error {
  margin-top: 12px;
  font-size: 12.5px;
}

/* 配置折叠区：展开时插在主按钮与卡底行之间（卡内文字回左对齐） */
.config-drawer {
  margin-top: 18px;
  text-align: left;
}

/* 卡底一行：左「平台设置 ▾」入口 + 右服务状态小字（12px g500） */
.card-foot {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--g100);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-toggle {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12.5px;
  color: var(--g600);
  cursor: pointer;
  transition: 0.15s;
}

.config-toggle:hover {
  color: var(--blue-700);
}

.service-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--g500);
  white-space: nowrap;
}

/* 健康点（沿 TopBar dot 语言：7px 圆点绿/红） */
.service-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.dot-green {
  background: var(--green);
}

.dot-red {
  background: var(--red);
}

@media (max-width: 760px) {
  .page {
    padding: 20px 18px 40px;
  }

  .hero {
    margin-bottom: 14px;
  }

  .card {
    margin-bottom: 0;
  }
}
</style>

/* 024 等待卡：拒绝原因/动作文案 + 按钮组居中（AccessActions 子组件 :deep 收口） */
.login-card .reason {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--red);
  background: var(--red-bg);
  border-radius: 8px;
  padding: 8px 12px;
  text-align: left;
}

.login-card .action-message {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--g500);
}

.login-card :deep(.actions) {
  justify-content: center;
  margin-top: 20px;
}
