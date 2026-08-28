<script setup lang="ts">
/**
 * 参数化占位页（I0-5 T3，设计 D-6）：employees 域仍用本页；
 * 标题/说明文案由域路由以 props 注入。bases / kanban 已换真页。
 * T7 视觉对齐原型：page-head 形态（h1 24px/700 + sub g500 13px）+ 内容区居中空态卡
 * （.card 语言 + g400 dot 装饰，简朴）。业务线落地时整页替换。
 */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="placeholder">
    <header class="page-head">
      <div>
        <h1>{{ title }}</h1>
        <p v-if="description" class="sub">{{ description }}</p>
      </div>
    </header>
    <div class="empty card" aria-hidden="true">
      <span class="deco-dot"></span>
    </div>
  </section>
</template>

<style scoped>
/* 原型 .page-head：标题区 + 下间距 18px */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.sub {
  color: var(--g500);
  margin-top: 5px;
  font-size: 13px;
}

/* 原型 .card 语言 + 居中空态（g400 dot 装饰，占位语义简朴） */
.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
}

.deco-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--g400);
}
</style>
