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
 * 登录与接入页（I0-5 T2，设计 §3：workbench-demo/src/ui.ts 的 Vue 化归宿）。
 * - 状态卡/动作区数据源 GET /api/state；审批中（authenticated 且 PENDING_REVIEW/APPROVED）
 *   每 5s POST /api/progress + 刷新（demo L31 节奏语义，onUnmounted/条件退出 clearInterval）；
 * - 服务健康徽章区承接 Home.vue 退役（I0-5 T4 起 fetchHealthz/interpretHealth/versionLineGated
 *   与顶栏共用 useHealthPolling composable——接入页全屏无顶栏，健康徽章仍保留在此）；
 * - 「返回管理平台」链接不渲染（设计 G-5：Vue 侧无 platformPublicUrl 来源，A 系列定稿后补）。
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
      <div class="mark">数</div>
      <div class="brand"><strong>数字员工工作台</strong><small>企业登录与可信接入</small></div>
      <div class="health" :class="badge.badgeClass">{{ badge.badge }} · {{ version }}</div>
    </header>
    <main class="page">
      <section class="hero">
        <div>
          <div class="eyebrow">Local execution plane</div>
          <h1>工作台接入状态</h1>
          <p class="muted">登录后将自动提交接入申请；审批通过并完成密钥证明后，才可以使用工作台能力。</p>
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
/* 视觉基调贴合 demo 配色（--forest/--mint/--lime 系），语义正确优先，非像素级复刻 */
.access-page {
  min-height: 100vh;
  background: #f5f8f6;
  color: #20302c;
  font: 14px/1.5 Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.head {
  height: 72px;
  background: #113b34;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: 12px;
}

.mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #c9f56d;
  color: #113b34;
  display: grid;
  place-items: center;
  font-weight: 900;
}

.brand small {
  display: block;
  color: #9fc0b8;
}

.health {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 700;
}

.health.ok {
  background: rgba(220, 245, 236, 0.9);
  color: #08775b;
}

.health.down {
  background: #ffe7ea;
  color: #ad2635;
}

.page {
  max-width: 1040px;
  margin: auto;
  padding: 42px 20px;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 30px;
  align-items: center;
  margin-bottom: 24px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #65b89c;
  font-weight: 900;
}

h1 {
  font-size: 36px;
  margin: 6px 0;
}

.grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 14px;
}

.card {
  background: #fff;
  border: 1px solid #dce7e2;
  border-radius: 16px;
  padding: 22px;
  box-shadow: 0 16px 45px #123c3510;
}

.row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #e8eeeb;
  align-items: center;
}

.row:last-of-type {
  border-bottom: 0;
}

.row span {
  color: #60716d;
}

.muted {
  color: #60716d;
}

.error {
  color: #ad2635;
}

@media (max-width: 760px) {
  .hero,
  .grid {
    display: block;
  }

  .card {
    margin-bottom: 12px;
  }
}
</style>
