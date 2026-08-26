<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import AccessActions from '../components/access/AccessActions.vue'
import AccessStatusCard from '../components/access/AccessStatusCard.vue'
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
 * 登录与接入页（I0-5 T2，设计 §3：workbench-demo/src/ui.ts 的 Vue 化归宿；T7 视觉蓝系化）。
 * - 状态卡/动作区数据源 GET /api/state；审批中（authenticated 且 PENDING_REVIEW/APPROVED）
 *   每 5s POST /api/progress + 刷新（demo L31 节奏语义，onUnmounted/条件退出 clearInterval）；
 * - 服务健康徽章区承接 Home.vue 退役（I0-5 T4 起 fetchHealthz/interpretHealth/versionLineGated
 *   与顶栏共用 useHealthPolling composable——接入页全屏无顶栏，健康徽章仍保留在此）；
 * - 「返回管理平台」链接不渲染（设计 G-5：Vue 侧无 platformPublicUrl 来源，A 系列定稿后补）。
 * T7 视觉（脚本零改动，只换皮）：头部品牌条沿侧栏蓝渐变语言 + 蓝渐变 logo 方块（原型人形 SVG）；
 * 健康徽章走原型 tag 体系（ok→tag-green/down→tag-red，模板层映射）+ 版本行白字 70% 透明度；
 * hero 区原型 page-head 规格（h1 24px/700 + eyebrow + sub g500 13px）；卡片原型 .card 语言。
 */

/** 审批进度轮询间隔（demo ui.ts L31 的 5s） */
const PROGRESS_POLL_MS = 5000

const state = ref<AccessState | null>(null)
/** 首次拉取失败（fetchAccessState 归一 null）→ 不可达文案；后续刷新失败保留旧状态卡 */
const loadFailed = ref(false)
/** 动作文案区（demo messageNode：处理中… / 操作成功 / 服务端错误消息） */
const message = ref('')
const { badge, version } = useHealthPolling()

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

onMounted(() => {
  void refresh()
  // 健康徽章轮询（挂载即拉 + 2s 周期 + 卸载清理）在 useHealthPolling 内接管
})

onBeforeUnmount(() => {
  if (progressTimer !== undefined) clearInterval(progressTimer)
})
</script>

<template>
  <div class="access-page">
    <header class="head">
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
      </div>
      <div class="brand">
        <strong>数字员工工作台</strong>
        <small>企业登录与可信接入</small>
      </div>
      <div class="health">
        <span class="tag" :class="badge.badgeClass === 'ok' ? 'tag-green' : 'tag-red'">{{ badge.badge }}</span>
        <span class="version">{{ version }}</span>
      </div>
    </header>
    <main class="page">
      <section class="hero">
        <div>
          <div class="eyebrow">Local execution plane</div>
          <h1>工作台接入状态</h1>
          <p class="sub">登录后将自动提交接入申请；审批通过并完成密钥证明后，才可以使用工作台能力。</p>
        </div>
        <!-- 「返回管理平台」链接不渲染（设计 G-5：platformPublicUrl 无前端来源） -->
      </section>
      <div class="grid">
        <section class="card">
          <h2>接入状态</h2>
          <p v-if="loadFailed && !state" class="error">服务不可达，无法获取接入状态</p>
          <p v-else-if="!state" class="muted">加载中…</p>
          <template v-else>
            <AccessStatusCard :state="state" />
            <AccessActions
              :state="state"
              @enroll="onEnroll"
              @heartbeat="onHeartbeat"
              @reset="onReset"
              @logout="onLogout"
            />
          </template>
          <p class="muted">{{ message }}</p>
        </section>
        <section class="card">
          <h2>安全边界</h2>
          <div class="row"><span>人员认证</span><strong>Keycloak OIDC + PKCE</strong></div>
          <div class="row"><span>审批控制</span><strong>按组织路径授权管理员</strong></div>
          <div class="row"><span>本机密钥</span><strong>ES256 · AES-GCM 加密落盘</strong></div>
          <div class="row"><span>机器认证</span><strong>private_key_jwt + Bearer Token</strong></div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* T7 蓝系：body 基调（--bg/--ink/字体栈）由全局 tokens.css 提供 */
.access-page {
  min-height: 100vh;
}

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

/* hero 区：原型 page-head 规格（h1 24px/700 + sub g500 13px）+ eyebrow 蓝系小字距 */
.hero {
  display: flex;
  justify-content: space-between;
  gap: 30px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--blue-500);
  font-weight: 600;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 5px 0 0;
}

.sub {
  color: var(--g500);
  margin-top: 5px;
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
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

/* 行 .row 沿用（token 化：span g500、行分隔 g100） */
.row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--g100);
  align-items: center;
}

.row:last-of-type {
  border-bottom: none;
}

.row span {
  color: var(--g500);
}

.muted {
  color: var(--g500);
  font-size: 13px;
  margin-top: 12px;
}

.error {
  color: var(--red);
}

@media (max-width: 760px) {
  .hero,
  .grid {
    display: block;
  }

  .hero {
    margin-bottom: 14px;
  }

  .card {
    margin-bottom: 12px;
  }
}
</style>
