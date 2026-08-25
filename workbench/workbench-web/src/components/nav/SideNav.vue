<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * 侧栏导航（I0-5 T3，F-02 导航骨架，设计 D-6）：
 * - 可点项三枚：我的员工（默认选中）/ 底座与环境 / 任务看板——选中态走 router-link active
 *   （vue-router 内建，无自定义选中逻辑）；
 * - 置灰项「我的群组与对话」：Q-010 群组能力未就绪不露死入口——无路由、不可点、不可聚焦，
 *   title 悬停提示「即将上线」；
 * - workflow 编排入口不渲染（D-036：编辑器/审批工作台仍留 L2）。
 */
</script>

<template>
  <nav class="side-nav" aria-label="主导航">
    <ul class="menu">
      <li><RouterLink to="/employees">我的员工</RouterLink></li>
      <li><RouterLink to="/bases">底座与环境</RouterLink></li>
      <li><RouterLink to="/kanban">任务看板</RouterLink></li>
      <!-- Q-010：群组能力未就绪——置灰占位（li 非链接、无 tabindex，不可聚焦可 hover 提示） -->
      <li class="disabled" title="即将上线">我的群组与对话</li>
    </ul>
    <!-- D-036：workflow 编排入口不渲染（仍留 L2） -->
  </nav>
</template>

<style scoped>
.side-nav {
  width: 232px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 20px 14px;
  background: #113b34;
  color: #e6f2ee;
}

.menu {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu li {
  margin: 0;
}

.menu a {
  display: block;
  padding: 10px 14px;
  border-radius: 10px;
  color: #cfe4dd;
  text-decoration: none;
  font-size: 14px;
}

.menu a:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

/* 选中态：router-link active（vue-router 内建类，含非精确父路径匹配） */
.menu a.router-link-active {
  background: rgba(201, 245, 109, 0.16);
  color: #c9f56d;
  font-weight: 700;
}

/* 置灰项：不可点（无路由不可聚焦），悬停 title 提示 */
.menu li.disabled {
  padding: 10px 14px;
  border-radius: 10px;
  color: #6e8a82;
  font-size: 14px;
  cursor: not-allowed;
  user-select: none;
}
</style>
