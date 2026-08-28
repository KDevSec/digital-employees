<script setup lang="ts">
/**
 * Step 6 · 其他
 *
 * 2026-08-28 用户裁决：Tools / Hook / 知识库 三个折叠区删除（当前无明确定制方式，避免干扰）。
 * 只保留「其他」自由备注 textarea（占位「其他扩展说明（可空）」）。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🧩</span> 扩展 —— 员工还需要什么</div>

    <div class="form-row" style="margin-bottom:0">
      <label>其他扩展说明（可空）</label>
      <textarea class="textarea misc-input" placeholder="其他扩展说明（可空）"></textarea>
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

/* demo .ext-sec：五轻折叠分区 */
.ext-sec {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 12px 18px;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.ext-sec summary {
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ink);
}

.ext-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.ext-chip {
  padding: 4px 13px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  background: var(--g100);
  color: var(--g600);
  border: 1px solid transparent;
  transition: 0.15s;
}

.ext-chip:hover {
  color: var(--blue-700);
}

.ext-hint {
  font-size: 12px;
  color: var(--g400);
  margin-top: 10px;
  line-height: 1.55;
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

.textarea {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  background: #fff;
  transition: 0.15s;
}

.textarea:focus {
  border-color: var(--blue-500);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.misc-input {
  min-height: 70px;
  resize: vertical;
  line-height: 1.55;
}
</style>
