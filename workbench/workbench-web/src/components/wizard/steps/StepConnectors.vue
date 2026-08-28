<script setup lang="ts">
import { computed } from 'vue'

import { useWizardStore } from '../../../stores/wizard'

/**
 * Step 7 · Connectors MCP（L1 员工新建线 Task 14）：
 * - MCP 模板默认连接器只读列表（selectedTemplate 的 connectors）；
 * - TemplateMeta 无 connectors 字段——显示「该模板无预置连接器」+ 说明「连接器编辑 V0.2 开放」。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */

const store = useWizardStore()

/** 当前选中模板（用于显示模板名） */
const selectedTemplate = computed(() => {
  if (!store.draft.selectedTemplateId) return null
  return store.templates.find((t) => t.id === store.draft.selectedTemplateId) ?? null
})

/** 模板预置连接器（store.draft.connectors 只读展示；当前为空数组） */
const connectors = computed(() => store.draft.connectors as Array<Record<string, unknown>>)
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🔌</span> 连接器 —— MCP 工具与数据源</div>

    <div class="form-row">
      <label>模板预置连接器</label>
      <div v-if="connectors.length > 0" class="connector-list">
        <div v-for="(c, idx) in connectors" :key="idx" class="connector-row">
          <span class="c-name">{{ c.name ?? `connector-${idx + 1}` }}</span>
          <span class="c-type">{{ c.type ?? 'unknown' }}</span>
        </div>
      </div>
      <div v-else class="hint-box">
        {{ selectedTemplate ? `「${selectedTemplate.display}」模板无预置连接器` : 'Custom 员工无预置连接器' }}
        —— 连接器编辑 V0.2 开放，当前版本 MCP 配置由员工包 mcp/ 目录文件承载。
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

.connector-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.connector-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 11px;
  background: var(--g100);
  border-radius: 8px;
  font-size: 12.5px;
}

.c-name {
  font-weight: 600;
  color: var(--ink);
}

.c-type {
  color: var(--g500);
  font-family: Menlo, Consolas, monospace;
  font-size: 11.5px;
}
</style>
