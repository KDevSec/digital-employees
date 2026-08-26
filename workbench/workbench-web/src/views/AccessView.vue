<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import AccessActions from '../components/access/AccessActions.vue'
import AccessStatusCard from '../components/access/AccessStatusCard.vue'
import PlatformConfigCard from '../components/access/PlatformConfigCard.vue'
import {
  enrollAction,
  fetchAccessState,
  heartbeatAction,
  logoutAction,
  progressAction,
  resetAction,
} from '../api/access'
import type { AccessState, ActionResult } from '../api/access'
import { useHealthPolling } from '../composables/useHealthPolling'

/**
 * 登录与接入页（I0-5 T2 立项：demo ui.ts 的 Vue 化归宿；T7 视觉蓝系化；T9 双形态重构 D-19/D-20）。
 * - 双形态分支（T9，state 驱动 template v-if）：
 *   · 未登录 = 居中单卡登录页（D-19）：logo 方块（同 SideNav 款蓝渐变+人形 SVG）+
 *     主标「研发零处数字员工终端」（T12/D-27；T13 起 DevZero 不作正式名称出现——CLAUDE.md §4）+ 引导语 + 整宽放大「登录」唯一主按钮 +
 *     卡底一行（左「平台设置 ▾」展开收纳 T8 配置卡 + 右服务状态·版本小字）。头部条在该
 *     形态下移除（页面更纯粹——登录卡自带品牌）；健康轮询逻辑保留，数据进卡底状态行；
 *   · 已登录 = 简化状态页（D-20）：安全边界卡删除（demo 时代开发者展示物）；头部条
 *     （品牌+健康徽章）保留；hero 简化为一行（h1 + sub 一句）；状态卡主位 + 平台配置卡
 *     次位（grid 单列，简洁优先）。
 * - 背景装饰（D-19）：--bg 底 + 左上/右下两团蓝渐变 radial 光斑（纯 CSS 无资源依赖），
 *   两形态共用（.access-page 一处声明）。
 * - 状态卡/动作区数据源 GET /api/state；审批中（authenticated 且 PENDING_REVIEW/APPROVED）
 *   每 5s POST /api/progress + 刷新（demo L31 节奏语义，onUnmounted/条件退出 clearInterval）；
 * - 服务健康徽章：useHealthPolling composable（2s 轮询）——已登录形态进头部条，
 *   未登录形态进卡底服务状态行；
 * - 「返回管理平台」链接不渲染（设计 G-5：Vue 侧无 platformPublicUrl 来源，A 系列定稿后补）。
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
const { badge, version } = useHealthPolling()

/** 双形态分流（D-19/D-20）：authenticated 才进状态页；未登录/不可达（state null）一律登录卡 */
const isLoggedIn = computed(() => state.value?.authenticated === true)

let progressTimer: ReturnType<typeof setInterval> | undefined

async function refresh(): Promise<void> {
  const next = await fetchAccessState()
  if (next) {
    state.value = next
    loadFailed.value = false
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

function onHeartbeat(): void {
  void run(heartbeatAction)
}

function onReset(): void {
  void run(resetAction)
}

// demo 登出成功后 location.reload()；SPA 下 run() 成功路径已重拉 /api/state，
// 等价回到未登录态渲染，不整页重载
function onLogout(): void {
  void run(logoutAction)
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
  // 健康徽章轮询（挂载即拉 + 2s 周期 + 卸载清理）在 useHealthPolling 内接管
})

onBeforeUnmount(() => {
  if (progressTimer !== undefined) clearInterval(progressTimer)
})
</script>

<template>
  <div class="access-page" :class="{ 'login-mode': !isLoggedIn }">
    <!-- 已登录形态：简化状态页（D-20）——头部条 + 一行 hero + 状态卡主位 + 配置卡次位 -->
    <template v-if="isLoggedIn">
      <header class="head">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
        </div>
        <div class="brand">
          <strong>研发零处数字员工终端</strong>
          <small>企业登录与可信接入</small>
        </div>
        <div class="health">
          <span class="tag" :class="badge.badgeClass === 'ok' ? 'tag-green' : 'tag-red'">{{ badge.badge }}</span>
          <span class="version">{{ version }}</span>
        </div>
      </header>
      <main class="page">
        <!-- hero 简化为一行（D-20）：h1 + sub 一句，eyebrow/侧挂配置卡移除 -->
        <section class="hero">
          <h1>终端接入状态</h1>
          <p class="sub">登录后将自动提交接入申请；审批通过并完成密钥证明后，才可以使用终端能力。</p>
        </section>
        <!-- 「返回管理平台」链接不渲染（设计 G-5：platformPublicUrl 无前端来源） -->
        <div class="grid">
          <!-- 状态卡主位（D-20） -->
          <section class="card">
            <h2>接入状态</h2>
            <AccessStatusCard :state="state" />
            <AccessActions
              :state="state"
              @enroll="onEnroll"
              @heartbeat="onHeartbeat"
              @reset="onReset"
              @logout="onLogout"
            />
            <p class="muted">{{ message }}</p>
          </section>
          <!-- 平台配置卡次位（D-20：T8 卡从 hero 侧挂迁入） -->
          <PlatformConfigCard />
        </div>
      </main>
    </template>

    <!-- 未登录形态：居中单卡登录页（D-19）——登录卡自带品牌，头部条移除 -->
    <main v-else class="login-wrap">
      <section class="card login-card">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
        </div>
        <h1 class="brand-name">研发零处数字员工终端</h1>
        <p class="lead">使用企业账号登录以继续</p>
        <!-- 整宽放大主按钮（btn-primary：padding 12px / 字号 15px / 整宽） -->
        <button type="button" class="btn btn-primary btn-login" @click="login">登录</button>
        <!-- 首次拉取失败 → 卡内不可达提示（登录卡骨架仍在，不白屏） -->
        <p v-if="loadFailed" class="error">服务不可达，无法获取接入状态</p>
        <!-- 「平台设置 ▾」折叠区（D-19：T8 配置卡收纳进登录卡） -->
        <div v-if="configOpen" class="config-drawer">
          <PlatformConfigCard />
        </div>
        <!-- 卡底一行：左「平台设置 ▾」入口 + 右服务状态·版本小字（健康轮询数据进卡底） -->
        <div class="card-foot">
          <button type="button" class="config-toggle" @click="configOpen = !configOpen">平台设置 ▾</button>
          <span class="service-status">
            <span class="dot" :class="badge.badgeClass === 'ok' ? 'dot-green' : 'dot-red'" aria-hidden="true"></span>
            {{ badge.badge }} · {{ version }}
          </span>
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
