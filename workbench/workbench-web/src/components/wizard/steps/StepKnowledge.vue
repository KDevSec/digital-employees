<script setup lang="ts">
/**
 * Step 6 · Knowledge（L1 员工新建线 Task 14）：
 * - 占位卡「知识库 · 暂未开放（V0.2 文档上传）」。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">📚</span> 知识 —— 员工懂什么</div>

    <div class="placeholder-card">
      <div class="placeholder-icon">📚</div>
      <div class="placeholder-title">知识库 · 暂未开放</div>
      <div class="placeholder-sub">V0.2 将开放文档上传与向量检索，当前版本员工知识由 skills 自带的 references 段承载。</div>
    </div>
  </div>
</template>

<style scoped>
.cat-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--g200);
}

.cat-section-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cat-icon {
  font-size: 16px;
}

.placeholder-card {
  background: var(--g100);
  border: 1px dashed var(--g300);
  border-radius: 12px;
  padding: 24px 22px;
  text-align: center;
}

.placeholder-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.placeholder-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g700);
  margin-bottom: 6px;
}

.placeholder-sub {
  font-size: 12px;
  color: var(--g500);
  line-height: 1.55;
  max-width: 420px;
  margin: 0 auto;
}
</style>
