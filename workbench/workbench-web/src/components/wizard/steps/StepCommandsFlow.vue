<script setup lang="ts">
/**
 * Step 5 · Commands 与流程（L1 员工新建线 Task 14）：
 * - Commands 占位说明（「Commands 预留（V0.2 开放）：slash 入口 → 发起任务」）；
 * - 流程区只读说明（统一文案「流程表随模板预置，生成时自动包含（当前仅开发工程师模板自带）」）。
 *
 * controller 裁决：TemplateMeta 不含 hasFlow 字段，本步统一显示静态文案不做动态判断；
 * Task 15/16 若 GET /api/templates 扩展字段再精化。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">📐</span> 流程 —— 员工怎么干活</div>

    <div class="form-row">
      <label>Commands 入口</label>
      <div class="hint-box">Commands 预留（V0.2 开放）：slash 入口 → 发起任务，与编排引擎联动。</div>
    </div>

    <div class="form-row">
      <label>个人流程表</label>
      <div class="hint-box">
        流程表随模板预置，生成时自动包含（当前仅开发工程师模板自带）。Custom 员工无自有流程表，
        可后续在员工包 orchestration/ 目录手写 node-table YAML 接入编排引擎。
      </div>
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

.form-row {
  margin-bottom: 16px;
}

.form-row label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--g700);
  margin-bottom: 6px;
}

.hint-box {
  background: var(--g100);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--g600);
  line-height: 1.55;
}
</style>
