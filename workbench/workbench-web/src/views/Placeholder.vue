<script setup lang="ts">
/**
 * 参数化占位页（I0-5 T3，设计 D-6）：employees/bases/kanban 三域路由共用，
 * 标题/说明文案由各域路由以 props 注入（见 src/router/routes/<domain>.ts）。
 * 风格简朴（占位语义），业务线落地时整页替换。
 */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="placeholder">
    <div class="mark" aria-hidden="true">·</div>
    <h1>{{ title }}</h1>
    <p v-if="description" class="muted">{{ description }}</p>
  </section>
</template>

<style scoped>
.placeholder {
  max-width: 560px;
  margin: 96px auto 0;
  padding: 40px;
  background: #fff;
  border: 1px solid #dce7e2;
  border-radius: 16px;
  text-align: center;
  box-shadow: 0 16px 45px #123c3510;
}

.mark {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: #c9f56d;
  color: #113b34;
  font-weight: 900;
  font-size: 20px;
}

h1 {
  font-size: 24px;
  margin: 0 0 8px;
  color: #20302c;
}

.muted {
  margin: 0;
  color: #60716d;
}
</style>
