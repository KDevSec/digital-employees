<script setup lang="ts">
import type { AccessState } from '../../api/access'

/**
 * 接入动作按钮组（I0-5 T2，设计 §3：demo ui.ts L29 显隐布尔式照搬，语义不动；T7 换皮原型 btn 体系）。
 * emit 交父组件（AccessView）统一调 api/access.ts 动作；登录按钮例外——
 * 是整页跳转 window.location.href='/auth/login'（OIDC 出站 302，非 SPA 导航），
 * 必须由浏览器发起 GET，不能走 SPA 内导航，故组件内直接置 location。
 * T7：登录 = btn-primary / 重提·心跳 = btn-ghost / 重置·登出 = btn-ghost 红字变体
 * （原型无 danger 按钮，按 token 延展见样式段注释）。
 */
const props = defineProps<{ state: AccessState }>()

const emit = defineEmits<{ enroll: []; heartbeat: []; reset: []; logout: [] }>()

function login(): void {
  window.location.href = '/auth/login'
}
</script>

<template>
  <div class="actions">
    <button v-if="!props.state.authenticated" class="btn btn-primary" @click="login">企业账号登录</button>
    <button
      v-if="props.state.authenticated && ['NEW', 'REJECTED', 'ERROR'].includes(props.state.status)"
      class="btn btn-ghost"
      @click="emit('enroll')"
    >重新提交接入申请</button>
    <button
      v-if="props.state.authenticated && props.state.status === 'ACTIVE'"
      class="btn btn-ghost"
      @click="emit('heartbeat')"
    >发送工作台心跳</button>
    <button
      v-if="props.state.authenticated && ['REJECTED', 'ERROR'].includes(props.state.status)"
      class="btn btn-ghost btn-danger"
      @click="emit('reset')"
    >重置申请状态</button>
    <button v-if="props.state.authenticated" class="btn btn-ghost btn-danger" @click="emit('logout')">退出登录</button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 18px;
}

/* 原型 .btn 语言 */
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

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:hover {
  background: var(--blue-700);
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

/* 危险变体（重置/登出）：原型无 danger 按钮样式，按 token 延展——
   ghost 形态 + red 文字，hover 换红 200（#fecaca）边框（声明顺序在 btn-ghost 之后以覆写字色） */
.btn-danger {
  color: var(--red);
}

.btn-danger:hover {
  border-color: #fecaca;
  color: var(--red);
}
</style>
