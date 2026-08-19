<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import type { Enrollment, PackageItem, Workbench } from '../../types'

const { t } = useI18n()
const session = useSessionStore()
const workbenches = ref<Workbench[]>([])
const enrollments = ref<Enrollment[]>([])
const packages = ref<PackageItem[]>([])
const loading = ref(true)

const canReview = computed(() => session.can('workbench.enrollment.review'))

const myWorkbench = computed(() => {
  const pid = session.me?.principal.id
  if (!pid) return undefined
  return workbenches.value.find((w) => w.owner_principal_id === pid)
})

const pendingEnrollments = computed(() =>
  workbenches.value
    .filter((w) => w.kind === 'enrollment' && w.status === 'PENDING_REVIEW')
    .slice(0, 8),
)

const recentWorkbenches = computed(() =>
  workbenches.value
    .filter((w) => w.kind !== 'enrollment')
    .slice(0, 8),
)

const kpis = computed(() => {
  const all = workbenches.value
  return {
    total: all.length,
    online: all.filter((w) => w.connection_status === 'ONLINE').length,
    pending: all.filter((w) => w.kind === 'enrollment' && w.status === 'PENDING_REVIEW').length,
    active: all.filter((w) => w.status === 'ACTIVE').length,
    rejected: all.filter((w) => w.status === 'REJECTED').length,
    revoked: all.filter((w) => w.status === 'REVOKED').length,
    packages: packages.value.length,
  }
})

function statusLabel(status: string) {
  return {
    ACTIVE: '已激活',
    PENDING_REVIEW: '待审批',
    APPROVED: '已批准待激活',
    COMPLETED: '已完成注册',
    REJECTED: '已拒绝',
    REVOKED: '已吊销',
  }[status] ?? status
}

function statusClass(status: string) {
  if (status === 'ACTIVE') return 'success'
  if (status === 'REJECTED' || status === 'REVOKED') return 'danger'
  if (status === 'PENDING_REVIEW' || status === 'APPROVED') return 'warning'
  return ''
}

function fmtTime(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

onMounted(async () => {
  try {
    const [wb, pkg] = await Promise.all([
      api<{ items: Workbench[] }>('/api/v1/workbenches?limit=50'),
      api<PackageItem[]>('/api/v1/public/workbench-packages'),
    ])
    workbenches.value = wb.items
    packages.value = pkg
    if (canReview.value) {
      enrollments.value = (await api<{ items: Enrollment[] }>('/api/v1/workbench-enrollments?limit=50')).items
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">Overview</p>
        <h1>{{ t('overview.title') }}</h1>
        <p>{{ t('overview.subtitle') }}</p>
      </div>
    </div>

    <div class="scope-banner">
      <strong>{{ t('app.currentRole') }}</strong>
      <span>{{ session.me?.principal.display_name }} · {{ session.me?.roles.map((r) => r.role_code).join('，') || '—' }}</span>
    </div>

    <!-- 我的工作台 -->
    <div v-if="myWorkbench" class="panel my-wb">
      <h2>我的工作台</h2>
      <div class="my-wb-grid">
        <div class="my-wb-info">
          <div class="row"><span>名称</span><strong>{{ myWorkbench.display_name }}</strong></div>
          <div class="row"><span>状态</span><span class="badge" :class="statusClass(myWorkbench.status)">{{ statusLabel(myWorkbench.status) }}</span></div>
          <div class="row" v-if="myWorkbench.org_path"><span>组织</span><strong>{{ myWorkbench.org_path }}</strong></div>
          <div class="row" v-if="myWorkbench.kind === 'enrollment' && myWorkbench.review_reason"><span>审批说明</span><strong>{{ myWorkbench.review_reason }}</strong></div>
          <div class="row"><span>创建时间</span><strong>{{ fmtTime(myWorkbench.created_at) }}</strong></div>
          <div class="row" v-if="myWorkbench.kind !== 'enrollment'"><span>最后心跳</span><strong>{{ fmtTime(myWorkbench.last_heartbeat_at) }}</strong></div>
        </div>
        <div v-if="myWorkbench.kind === 'enrollment' && myWorkbench.status === 'PENDING_REVIEW'" class="my-wb-notice">
          <strong>接入审批中</strong>
          <p>你的工作台已提交接入申请，等待部门管理员审批。审批通过后将自动完成激活。</p>
        </div>
        <div v-else-if="myWorkbench.status === 'ACTIVE'" class="my-wb-notice ok">
          <strong>工作台已激活</strong>
          <p>连接状态：{{ myWorkbench.connection_status }}，可正常使用工作台能力。</p>
        </div>
        <div v-else-if="myWorkbench.status === 'REJECTED'" class="my-wb-notice bad">
          <strong>接入申请被拒绝</strong>
          <p v-if="myWorkbench.review_reason">原因：{{ myWorkbench.review_reason }}</p>
        </div>
      </div>
    </div>

    <!-- KPI 统计 -->
    <div class="kpi-grid">
      <article class="kpi"><span>范围内工作台</span><strong>{{ kpis.total }}</strong></article>
      <article class="kpi"><span>在线</span><strong>{{ kpis.online }}</strong></article>
      <article class="kpi"><span>已激活</span><strong>{{ kpis.active }}</strong></article>
      <article class="kpi"><span>待审批</span><strong>{{ kpis.pending }}</strong></article>
      <article class="kpi kpi-danger"><span>已拒绝/吊销</span><strong>{{ kpis.rejected + kpis.revoked }}</strong></article>
      <article class="kpi"><span>公开安装包</span><strong>{{ kpis.packages }}</strong></article>
    </div>

    <div class="overview-grid">
      <!-- 待审批接入申请 -->
      <div v-if="canReview" class="panel">
        <h2>待审批接入申请</h2>
        <div v-if="pendingEnrollments.length === 0" class="empty-hint">当前没有待审批的申请。</div>
        <table v-else class="mini-table">
          <thead><tr><th>工作台</th><th>申请人</th><th>组织</th><th>提交时间</th></tr></thead>
          <tbody>
            <tr v-for="item in pendingEnrollments" :key="item.id">
              <td>{{ item.display_name }}</td>
              <td>{{ item.owner_display_name }}</td>
              <td>{{ item.org_path || '—' }}</td>
              <td>{{ fmtTime(item.created_at) }}</td>
            </tr>
          </tbody>
        </table>
        <router-link v-if="pendingEnrollments.length > 0" to="/app/enrollments" class="button" style="margin-top:12px">前往审批</router-link>
      </div>

      <!-- 最近工作台 -->
      <div class="panel">
        <h2>最近工作台</h2>
        <div v-if="recentWorkbenches.length === 0" class="empty-hint">当前范围内还没有已激活的工作台。</div>
        <table v-else class="mini-table">
          <thead><tr><th>名称</th><th>所有人</th><th>状态</th><th>连接</th><th>最后心跳</th></tr></thead>
          <tbody>
            <tr v-for="item in recentWorkbenches" :key="item.id">
              <td>{{ item.display_name }}</td>
              <td>{{ item.owner_display_name }}</td>
              <td><span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span></td>
              <td>{{ item.connection_status }}</td>
              <td>{{ fmtTime(item.last_heartbeat_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 可信接入主链 -->
    <div class="panel">
      <h2>可信接入主链</h2>
      <div class="flow">
        <span>1. OIDC + PKCE<br><small>企业账号登录</small></span>
        <span>2. 人工审批<br><small>部门管理员按组织范围审批</small></span>
        <span>3. ES256 持钥证明<br><small>一次性 challenge 绑定本机密钥</small></span>
        <span>4. 机器 Token 心跳<br><small>短期凭证 · 可撤销</small></span>
      </div>
    </div>
  </section>
</template>
