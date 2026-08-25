<script setup lang="ts">
import { RouterView } from 'vue-router'

import SideNav from './SideNav.vue'

/**
 * 登录态业务页统一布局（I0-5 T3，设计 D-5）：侧栏 SideNav + 内容区 router-view。
 * 顶栏为 F-04（I0-5 T4）TopBar 全局态预留槽位——当前以注释占位，T4 挂载后承接
 * 用户区/平台状态徽章/版本行/检查更新占位按钮。
 * 接入页（access 域 '/'）不走本布局：顶层独立全屏（D-5 未登录不露导航）。
 */
</script>

<template>
  <div class="layout">
    <SideNav />
    <div class="main">
      <!-- 顶栏槽位：I0-5 T4（F-04）在此挂 TopBar -->
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: #f5f8f6;
  color: #20302c;
  font: 14px/1.5 Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  padding: 28px;
}
</style>
