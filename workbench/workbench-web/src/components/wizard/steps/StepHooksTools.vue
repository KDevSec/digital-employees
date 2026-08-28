<script setup lang="ts">
import { computed } from 'vue'

import { useWizardStore, ALL_TOOLS } from '../../../stores/wizard'

/**
 * Step 4 · 约束与工具（L1 员工新建线 Task 14 + 2026-08-28 UX 迭代）：
 * - 权限红线 check-grid（6 项真实红线 + 1 项自定义灰置）——描述改为「主描述 + 括号举例」；
 * - 工具白名单 chip 区（默认全勾 10 工具；反选 → deny 反向构造）；
 * - 高级设置整段移除（tier/token/可见性/审计/治理级别 UI 删除，draft 静默注入默认值）。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */

const store = useWizardStore()

/** 红线 7 项（2026-08-28 裁决：主描述 + 括号举例） */
interface RedlineOption {
  rule_id: string
  label: string
  disabled?: boolean
}

const REDLINES: RedlineOption[] = [
  { rule_id: 'no-push-to-main', label: '禁止直接推送到主分支（如 git push origin main / master）' },
  { rule_id: 'high-risk-via-gate', label: '危险操作必须经人工确认（如 rm -rf、删除文件夹、修改系统配置）' },
  { rule_id: 'no-devzero-state', label: '禁止修改运行时状态文件（如 .devzero/ 目录下任何文件）' },
  { rule_id: 'no-external-request', label: '禁止访问外网（如 curl / wget / 任何 HTTP 请求外部站点）' },
  { rule_id: 'no-production-access', label: '禁止访问生产环境（如 prod 域名/IP、/etc/prod/ 路径）' },
  { rule_id: 'no-db-schema', label: '禁止修改数据库结构（如 ALTER TABLE、DROP TABLE、CREATE INDEX）' },
  { rule_id: 'custom', label: '自定义红线规则（暂未开放）', disabled: true },
]

/** 红线勾选态 */
function isRedlineOn(ruleId: string): boolean {
  return store.draft.redlines.some((r) => r.rule_id === ruleId)
}

function toggleRedline(rule: RedlineOption): void {
  if (rule.disabled) return
  if (isRedlineOn(rule.rule_id)) {
    store.draft.redlines = store.draft.redlines.filter((r) => r.rule_id !== rule.rule_id)
  } else {
    store.draft.redlines = [...store.draft.redlines, { rule_id: rule.rule_id, compiled: false }]
  }
}

/** 工具白名单勾选态 */
function isToolOn(tool: string): boolean {
  return store.draft.toolsAllowed.includes(tool)
}

/** 工具白名单切换 + deny 反向构造 */
function toggleTool(tool: string): void {
  if (isToolOn(tool)) {
    store.draft.toolsAllowed = store.draft.toolsAllowed.filter((t) => t !== tool)
  } else {
    store.draft.toolsAllowed = [...store.draft.toolsAllowed, tool]
  }
  // deny 反向构造：全集 - 已勾
  store.draft.deny = ALL_TOOLS.filter((t) => !store.draft.toolsAllowed.includes(t))
}

/** deny 同步（computed 展示用，实际值由 toggleTool 写入） */
const denyPreview = computed(() => {
  if (store.draft.deny.length === 0) return '无禁用工具'
  return `禁用：${store.draft.deny.join('、')}`
})
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🛡️</span> 约束 —— 员工不能干什么</div>

    <div class="form-row">
      <label>权限红线（写入 constraints.red_lines）</label>
      <div class="check-grid">
        <div
          v-for="rule in REDLINES"
          :key="rule.rule_id"
          class="check-item"
          :class="{ on: isRedlineOn(rule.rule_id), disabled: rule.disabled }"
          data-redline
          @click="toggleRedline(rule)"
        >
          <span class="box">✓</span>{{ rule.label }}
        </div>
      </div>
    </div>

    <div class="form-row">
      <label>工具白名单（默认全选 = 全部工具可用；取消勾选 = 加入禁用清单）</label>
      <div class="tools-grid">
        <div
          v-for="tool in ALL_TOOLS"
          :key="tool"
          class="tool-chip"
          :class="{ on: isToolOn(tool) }"
          :data-tool="tool"
          @click="toggleTool(tool)"
        >
          <span class="tool-check">✓</span>{{ tool }}
        </div>
      </div>
      <div class="deny-preview" data-role="deny-preview">{{ denyPreview }}</div>
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

/* check-grid（红线） */
.check-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--g200);
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 12.5px;
  cursor: pointer;
  transition: 0.12s;
  background: #fff;
  line-height: 1.45;
}

.check-item:hover {
  border-color: var(--blue-300);
}

.check-item.on {
  border-color: var(--blue-500);
  background: var(--blue-50);
  color: var(--blue-800);
}

.check-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.check-item.disabled:hover {
  border-color: var(--g200);
}

.check-item .box {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  border: 1.5px solid var(--g300);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
}

.check-item.on .box {
  background: var(--blue-600);
  border-color: var(--blue-600);
}

/* 工具白名单 chip 区 */
.tools-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  background: var(--g100);
  color: var(--g600);
  border: 1.5px solid transparent;
  transition: 0.12s;
  font-family: Menlo, Consolas, monospace;
}

.tool-chip:hover {
  border-color: var(--blue-300);
}

.tool-chip.on {
  background: var(--blue-100);
  color: var(--blue-700);
  border-color: var(--blue-500);
  font-weight: 500;
}

.tool-chip .tool-check {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--g300);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #fff;
  background: transparent;
}

.tool-chip.on .tool-check {
  background: var(--blue-600);
  border-color: var(--blue-600);
}

.deny-preview {
  margin-top: 10px;
  font-size: 12px;
  color: var(--g500);
  font-family: Menlo, Consolas, monospace;
}
</style>
