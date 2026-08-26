<script setup lang="ts">
import { RouterView } from 'vue-router'

import SideNav from './SideNav.vue'
import TopBar from './TopBar.vue'

/**
 * 登录态业务页统一布局（I0-5 T3，设计 D-5；T7 对齐原型 .app/.main 结构）：
 * 外层 .app（flex 横向壳，全局 token 提供 display:flex/min-height:100vh）+ SideNav +
 * main（原型 .main：flex:1 / min-width:0 / padding 26px 34px 60px）。
 * 原型无全局顶栏条——TopBar 以白卡片形态放 main 顶部（F-04 全局态：用户区/平台状态
 * 徽章与告警条/版本行/检查更新占位按钮），内容区 router-view 随后。
 * 接入页（access 域 '/'）不走本布局：顶层独立全屏（D-5 未登录不露导航）。
 */
</script>

<template>
  <div class="app">
    <SideNav />
    <main class="main">
      <TopBar />
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
