<script setup lang="ts">
import { ref } from 'vue'
import { RouterView } from 'vue-router'

import AccessModal from '../access/AccessModal.vue'
import AlertBar from './AlertBar.vue'
import SettingsPanel from './SettingsPanel.vue'
import SideNav from './SideNav.vue'

/**
 * 登录态业务页统一布局（I0-5 T3，设计 D-5；T7 对齐原型 .app/.main 结构；T10 D-23~D-25
 * 设置聚合重构——TopBar 退役；T11 D-26 接入与平台设置弹窗接线）：
 * 外层 .app（flex 横向壳，全局 token 提供 display:flex/min-height:100vh）+ SideNav +
 * main（原型 .main：flex:1 / min-width:0 / padding 26px 34px 60px）。
 * T10 组装：
 * - SideNav 底部齿轮（D-23 sidebar-foot）emit openSettings → Layout 本地 ref 开关设置浮层；
 * - SettingsPanel（D-24）侧栏外常驻挂载（v-model:open 受控；固定定位从侧栏底部向上弹出，
 *   原 TopBar 用户区/平台状态/版本行/检查更新/设置动作全部收纳于此）；
 * - main 顶部条件渲染 AlertBar（D-25：平台 unreachable/revoked 常驻红条，正常态零占位——
 *   组件内部 v-if，Layout 无需重复 interpretPlatformStatus 判定）。
 * T11 组装（D-26）：
 * - SettingsPanel @open-access（第三项 button，RouterLink 跳 '/' 退役）→ openAccessModal
 *   开 AccessModal（居中 mask+白卡，内嵌状态卡/配置卡/动作组三件套）；关闭即回原业务页
 *   （URL 不动，上下文不丢）——ACTIVE 用户不再被引去全屏路由；
 * - 两浮层互斥（D-26）：开弹窗必收设置浮层（openAccessModal 双写）；关弹窗不复活浮层
 *   （单向互斥——关弹窗是回业务页，不是回浮层）。
 * main 顶部不再有 TopBar 卡片条：原型本无全局顶栏，padding 维持原型值 26px 34px 60px。
 * 接入页（access 域 '/'）不走本布局：顶层独立全屏（D-5 未登录不露导航）。
 */

/** 设置浮层开合（D-24：开关状态归 Layout 本地 ref；齿轮再点收起） */
const settingsOpen = ref(false)

/** 接入与平台设置弹窗开合（D-26：AccessModal v-model:open 受控，与设置浮层互斥） */
const accessOpen = ref(false)

function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value
}

/** D-26：开接入弹窗（设置浮层第三项 emit）——互斥：收浮层 + 开弹窗 */
function openAccessModal(): void {
  settingsOpen.value = false
  accessOpen.value = true
}
</script>

<template>
  <div class="app">
    <SideNav @open-settings="toggleSettings" />
    <!-- D-24：设置浮层常驻挂载（fixed 定位从侧栏底部向上弹出，不在文档流内）；
         D-26：第三项 @open-access 开接入弹窗（RouterLink 跳 '/' 退役） -->
    <SettingsPanel v-model:open="settingsOpen" @open-access="openAccessModal" />
    <!-- D-26：接入与平台设置弹窗常驻挂载（v-model:open 受控；open=false 时 DOM 零渲染） -->
    <AccessModal v-model:open="accessOpen" />
    <main class="main">
      <!-- D-25：平台告警条（unreachable/revoked 常驻红条，正常态零渲染零占位） -->
      <AlertBar />
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
/* 原型 .main：主区内边距（.app 横向壳与 body 基调由全局 tokens.css 提供） */
.main {
  flex: 1;
  min-width: 0;
  padding: 26px 34px 60px;
}
</style>
