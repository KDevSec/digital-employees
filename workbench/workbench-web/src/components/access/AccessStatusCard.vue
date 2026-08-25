<script setup lang="ts">
import { computed } from 'vue'

import { statusBadgeClass, statusLabel } from '../../api/access'
import type { AccessState } from '../../api/access'

/**
 * 接入状态卡（I0-5 T2，设计 §3：demo ui.ts L28 `#state` 行 + 条件块原样迁移）。
 * demo 的 esc() 手工转义由模板插值自动转义消解；空值显示 '-'（esc(value ?? '-') 语义）。
 */
const props = defineProps<{ state: AccessState }>()

/** demo locked 数组原样（ui.ts L28）——不含 REVOKED/ACTIVE */
const LOCKED_STATUSES = ['NEW', 'PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'REJECTED', 'ERROR']

/** 企业用户行：demo `user?.name || user?.preferred_username || '已登录'` 回退链 */
const userName = computed(
  () => props.state.user?.name || props.state.user?.preferred_username || '已登录',
)

const locked = computed(() => LOCKED_STATUSES.includes(props.state.status))
</script>

<template>
  <div class="status-rows">
    <div class="row"><span>企业用户</span><strong>{{ props.state.authenticated ? userName : '未登录' }}</strong></div>
    <div class="row"><span>Installation ID</span><strong>{{ props.state.installationId ?? '-' }}</strong></div>
    <div class="row"><span>申请 ID</span><strong>{{ props.state.enrollmentId ?? '-' }}</strong></div>
    <div class="row"><span>工作台 ID</span><strong>{{ props.state.workbenchId ?? '-' }}</strong></div>
    <div class="row"><span>状态</span><strong><span class="badge" :class="statusBadgeClass(props.state.status)">{{ statusLabel(props.state.status) }}</span></strong></div>
    <div class="row"><span>最后心跳</span><strong>{{ props.state.lastHeartbeatAt ?? '-' }}</strong></div>

    <div v-if="props.state.rejectionReason" class="notice error">
      <strong>拒绝原因</strong>{{ props.state.rejectionReason }}
    </div>
    <div v-if="props.state.error" class="notice error">
      <strong>申请异常</strong>{{ props.state.error }}
    </div>
    <div v-if="!props.state.authenticated" class="notice">
      <strong>请先登录</strong>工作台需要通过企业账号完成 Keycloak 认证。
    </div>
    <div v-else-if="locked" class="notice">
      <strong>能力已锁定</strong>接入申请审批通过并完成本机激活后，才可发送心跳和使用其他工作台能力。
    </div>
  </div>
</template>

<style scoped>
/* 视觉基调贴合 demo 配色（--forest/--mint/--lime），语义正确优先，非像素级复刻 */
.row {
  display: grid;
  grid-template-columns: 170px 1fr;
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

.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 850;
  background: #eef2f1;
  color: #44534e;
}

.badge.ok {
  background: #dcf5ec;
  color: #08775b;
}

.badge.pending {
  background: #fff2d8;
  color: #9a5a07;
}

.badge.error {
  background: #ffe7ea;
  color: #ad2635;
}

.badge.neutral {
  background: #eef2f1;
  color: #44534e;
}

.notice {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f3f7f5;
  border: 1px solid #dce7e2;
}

.notice strong {
  display: block;
  margin-bottom: 4px;
}

.notice.error {
  background: #fff0f1;
  border-color: #efb5ba;
  color: #a32635;
}
</style>
