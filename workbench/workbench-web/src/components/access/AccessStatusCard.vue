<script setup lang="ts">
import { computed } from 'vue'

import { statusBadgeClass, statusLabel } from '../../api/access'
import type { AccessState } from '../../api/access'

/**
 * 接入状态卡（I0-5 T2，设计 §3：demo ui.ts L28 `#state` 行 + 条件块原样迁移；T7 视觉蓝系化）。
 * demo 的 esc() 手工转义由模板插值自动转义消解；空值显示 '-'（esc(value ?? '-') 语义）。
 * T7：状态徽章走原型 tag 体系——statusBadgeClass 的语义类（ok/pending/error/neutral）在组件层
 * 映射 tag-green/tag-amber/tag-red/tag-gray（纯函数返回形状不变，语义类同时保留在 DOM 上）。
 */
const props = defineProps<{ state: AccessState }>()

/** demo locked 数组原样（ui.ts L28）——不含 REVOKED/ACTIVE */
const LOCKED_STATUSES = ['NEW', 'PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'REJECTED', 'ERROR']

/** 徽章语义类 → 原型 tag 类的纯视觉映射（语义类保留——access-status-card.test 断言依赖） */
const TAG_BY_BADGE_CLASS = { ok: 'tag-green', pending: 'tag-amber', error: 'tag-red', neutral: 'tag-gray' } as const

/** 企业用户行：demo `user?.name || user?.preferred_username || '已登录'` 回退链 */
const userName = computed(
  () => props.state.user?.name || props.state.user?.preferred_username || '已登录',
)

const locked = computed(() => LOCKED_STATUSES.includes(props.state.status))

const badgeClass = computed(() => statusBadgeClass(props.state.status))
</script>

<template>
  <div class="status-rows">
    <div class="row"><span>企业用户</span><strong>{{ props.state.authenticated ? userName : '未登录' }}</strong></div>
    <div class="row"><span>Installation ID</span><strong>{{ props.state.installationId ?? '-' }}</strong></div>
    <div class="row"><span>申请 ID</span><strong>{{ props.state.enrollmentId ?? '-' }}</strong></div>
    <div class="row"><span>工作台 ID</span><strong>{{ props.state.workbenchId ?? '-' }}</strong></div>
    <div class="row"><span>状态</span><strong><span class="badge" :class="[TAG_BY_BADGE_CLASS[badgeClass], badgeClass]">{{ statusLabel(props.state.status) }}</span></strong></div>
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
/* 行 .row 沿用（token 化：span g500、行分隔 g100） */
.row {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--g100);
  align-items: center;
}

.row:last-of-type {
  border-bottom: 0;
}

/* 行 .row 沿用（token 化：span g500、行分隔 g100）。
   标签用直接子选择器：状态徽章（strong 内嵌 span.badge）也是 .row 后代，
   裸后代选择器的特异度（.row span+data-v = 0,2,1）会压过单类 tag 色板（0,2,0） */
.row > span {
  color: var(--g500);
}

/* 状态徽章：原型 .tag 语言（pill）+ tag 色板（语义类保留在 DOM 上供断言/语义锚点） */
.badge {
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

/* 提示块：浅底圆角提示条（请先登录/能力已锁定 = blue-50；拒绝原因/申请异常 = red-bg） */
.notice {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--blue-50);
  color: var(--g700);
}

.notice strong {
  display: block;
  margin-bottom: 4px;
}

.notice.error {
  background: var(--red-bg);
  color: var(--red);
}
</style>
