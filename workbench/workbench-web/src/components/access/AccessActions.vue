<script setup lang="ts">
import type { AccessState } from '../../api/access'

/**
 * 接入动作按钮组（I0-5 T2，设计 §3：demo ui.ts L29 显隐布尔式照搬，语义不动）。
 * emit 交父组件（AccessView）统一调 api/access.ts 动作；登录按钮例外——
 * 是整页跳转 window.location.href='/auth/login'（OIDC 出站 302，非 SPA 导航），
 * 必须由浏览器发起 GET，不能走 SPA 内导航，故组件内直接置 location。
 */
const props = defineProps<{ state: AccessState }>()

const emit = defineEmits<{ enroll: []; heartbeat: []; reset: []; logout: [] }>()

function login(): void {
  window.location.href = '/auth/login'
}
</script>

<template>
  <div class="actions">
    <button v-if="!props.state.authenticated" class="primary" @click="login">企业账号登录</button>
    <button
      v-if="props.state.authenticated && ['NEW', 'REJECTED', 'ERROR'].includes(props.state.status)"
      class="accent"
      @click="emit('enroll')"
    >重新提交接入申请</button>
    <button
      v-if="props.state.authenticated && props.state.status === 'ACTIVE'"
      @click="emit('heartbeat')"
    >发送工作台心跳</button>
    <button
      v-if="props.state.authenticated && ['REJECTED', 'ERROR'].includes(props.state.status)"
      class="danger"
      @click="emit('reset')"
    >重置申请状态</button>
    <button v-if="props.state.authenticated" class="danger" @click="emit('logout')">退出登录</button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 18px;
}

button {
  border: 1px solid #dce7e2;
  background: #fff;
  border-radius: 9px;
  padding: 10px 15px;
  font-weight: 800;
  cursor: pointer;
  color: #24332f;
}

button.primary {
  background: #113b34;
  border-color: #113b34;
  color: #fff;
}

button.accent {
  background: #c9f56d;
  border-color: #c9f56d;
  color: #113b34;
}

button.danger {
  background: #fff0f1;
  border-color: #efb5ba;
  color: #a32635;
}
</style>
