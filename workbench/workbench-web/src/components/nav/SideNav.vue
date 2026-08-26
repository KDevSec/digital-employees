<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * 侧栏导航（I0-5 T3 骨架，T7 视觉对齐原型 workbench.html `<aside class="sidebar">` 段；
 * T10 增 D-23 sidebar-foot 设置齿轮）：
 * - 形态：78px 窄图标栏 + 纵向蓝渐变（blue-950→blue-800）+ sticky 100vh；
 *   logo 44px 蓝渐变方块 + 原型人形 SVG，title「数字员工工作台」；
 * - 可点项三枚：我的员工（默认选中）/ 底座与环境 / 任务看板——RouterLink 样式化为原型
 *   nav-item（竖排 SVG 图标 21px + 10.5px 微字），选中态走 router-link active
 *   （vue-router 内建，无自定义选中逻辑；原型 nav-item.active 的底色/内描边语言）；
 * - 置灰项「我的群组与对话」：Q-010 群组能力未就绪不露死入口——同 nav-item 形态但
 *   disabled（无路由、不可点、不可聚焦、降透明度/去 hover），title 悬停提示「即将上线」；
 * - workflow 编排入口不渲染（D-036：编辑器/审批工作台仍留 L2）；
 * - D-23 设置齿轮：nav 之后 .sidebar-foot（原型结构，nav flex:1 把它压到底）内一枚
 *   nav-item 形态按钮（原型齿轮 SVG + 「设置」微字），点击 emit openSettings 交 Layout
 *   开设置浮层（D-24 浮层自身固定定位从侧栏底部向上弹出）。齿轮点击 @click.stop 阻断
 *   冒泡——浮层的外点关闭监听在 document 上，不阻断会把「开浮层的这一次点击」当成外点
 *   立即关掉（开浮层与外点判定同一事件内先后触发）。
 * 图标 SVG path 逐枚取自原型侧栏（脉冲线/显示器/三列柱/气泡/齿轮）。
 */

const emit = defineEmits<{ openSettings: [] }>()
</script>

<template>
  <aside class="sidebar">
    <div class="logo" title="数字员工工作台">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0 1 16 0v1" /></svg>
    </div>
    <nav class="nav" aria-label="主导航">
      <ul class="menu">
        <li>
          <RouterLink class="nav-item" to="/employees">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
            <span>我的员工</span>
          </RouterLink>
        </li>
        <li>
          <RouterLink class="nav-item" to="/bases">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            <span>底座与环境</span>
          </RouterLink>
        </li>
        <li>
          <RouterLink class="nav-item" to="/kanban">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="8" rx="1" /></svg>
            <span>任务看板</span>
          </RouterLink>
        </li>
        <!-- Q-010：群组能力未就绪——置灰占位（li 非链接、无 tabindex，不可聚焦可 hover 提示） -->
        <li class="nav-item disabled" title="即将上线">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <span>我的群组与对话</span>
        </li>
      </ul>
    </nav>
    <!-- D-036：workflow 编排入口不渲染（仍留 L2） -->
    <!-- D-23：设置按钮落位侧栏底部（原型 .sidebar-foot）——@click.stop 见组件头注释 -->
    <div class="sidebar-foot">
      <button
        type="button"
        class="nav-item"
        aria-label="设置"
        @click.stop="emit('openSettings')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        <span>设置</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
/* 原型 .sidebar：78px 窄图标栏 + 纵向蓝渐变 + sticky 100vh */
.sidebar {
  width: 78px;
  background: linear-gradient(180deg, var(--blue-950) 0%, var(--blue-900) 55%, var(--blue-800) 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  position: sticky;
  top: 0;
  height: 100vh;
  flex-shrink: 0;
  z-index: 20;
}

/* 原型 .logo：44px 蓝渐变方块 + 人形 SVG（stroke #fff） */
.logo {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: linear-gradient(135deg, var(--blue-500), var(--blue-400));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.45);
}

.logo svg {
  width: 26px;
  height: 26px;
}

.nav {
  flex: 1;
}

.menu {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 原型 .nav-item：62px 宽竖排（图标 21px + 10.5px 微字），锚点形态补 text-decoration: none */
.nav-item {
  width: 62px;
  padding: 9px 0 7px;
  border: none;
  background: transparent;
  border-radius: 12px;
  color: var(--blue-200);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: 0.15s;
  text-decoration: none;
  /* 设置齿轮是 button 元素（其余 nav-item 为 RouterLink 锚点）：button 不继承字体，显式归队 */
  font-family: inherit;
}

.nav-item svg {
  width: 21px;
  height: 21px;
  stroke: currentColor;
}

.nav-item span {
  font-size: 10.5px;
  line-height: 1;
  white-space: nowrap;
}

.nav-item:hover {
  background: rgba(147, 197, 253, 0.16);
  color: #fff;
}

/* 选中态：router-link active（vue-router 内建类，含非精确父路径匹配）——原型 .nav-item.active 语言 */
.nav-item.router-link-active {
  background: rgba(96, 165, 250, 0.28);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.4);
}

/* 置灰项：同 nav-item 形态但 disabled（无路由不可聚焦），降透明度/去 hover，title 悬停提示 */
.nav-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  user-select: none;
}

.nav-item.disabled:hover {
  background: transparent;
  color: var(--blue-200);
}

/* 原型 .sidebar-foot：侧栏底部区（nav flex:1 把它压到底），竖排 gap 6px */
.sidebar-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
