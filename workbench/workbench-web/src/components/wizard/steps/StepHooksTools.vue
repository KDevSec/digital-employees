<script setup lang="ts">
import { computed } from 'vue'

import { useWizardStore, ALL_TOOLS } from '../../../stores/wizard'

/**
 * Step 4 · 约束与工具（2026-08-31 用户裁决 restructure）：
 * ① 权限红线（hooks 规则拦截，编译期生效；整套作用域挂在「权限管理总开关」下）
 * ② 工具黑名单（PreToolUse 拦截工具调用；作用域仅「工具调用」一层，与红线互不相干）
 * ③ 权限管理总开关：总开→全部规则启用；总关→整套拦截不启用（draft 侧 UI 态，
 *    不写入 manifest；生成器拆成：开 → redlines 编译 + deny 下发；关 → 两者都不下发）
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

/** 权限管理总开关（draft 侧 UI 态） */
const redlinesEnabled = computed({
  get: () => store.draft.redlinesEnabled,
  set: (v: boolean) => {
    store.draft.redlinesEnabled = v
  },
})

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

/** 工具黑名单勾选态（反向：勾选 = 禁用该工具） */
function isToolDenied(tool: string): boolean {
  return store.draft.deny.includes(tool)
}

/** 工具黑名单切换 */
function toggleToolDeny(tool: string): void {
  if (isToolDenied(tool)) {
    store.draft.deny = store.draft.deny.filter((t) => t !== tool)
  } else {
    store.draft.deny = [...store.draft.deny, tool]
  }
}

/** 当前已选中的红线数 / 已禁工具数（徽章文案） */
const enabledRedlines = computed(() => store.draft.redlines.length)
const deniedTools = computed(() => store.draft.deny.length)
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🛡️</span> 约束 —— 员工不能干什么</div>

    <!-- 权限管理总开关 -->
    <div class="form-row master-row">
      <label class="master-toggle">
        <input
          type="checkbox"
          data-role="redlines-master"
          :checked="redlinesEnabled"
          @change="redlinesEnabled = ($event.target as HTMLInputElement).checked"
        />
        <span class="master-label">
          权限管理总开关
          <span class="master-sub">总关 → 下述红线与工具黑名单全部不启用（不写入员工包）</span>
        </span>
      </label>
      <span class="master-count" data-role="redlines-summary">
        {{ redlinesEnabled ? `已启用 ${enabledRedlines} 条红线` : '已停用' }}
      </span>
    </div>

    <!-- 权限红线（总开关下） -->
    <div class="form-row" :class="{ 'section-disabled': !redlinesEnabled }">
      <label>权限红线（hooks 规则拦截，编译期生效）</label>
      <div class="check-grid">
        <div
          v-for="rule in REDLINES"
          :key="rule.rule_id"
          class="check-item"
          :class="{ on: isRedlineOn(rule.rule_id), disabled: rule.disabled || !redlinesEnabled }"
          data-redline
          @click="toggleRedline(rule)"
        >
          <span class="box">✓</span>{{ rule.label }}
        </div>
      </div>
    </div>

    <!-- 工具黑名单（与红线互不干涉） -->
    <div class="form-row" :class="{ 'section-disabled': !redlinesEnabled }">
      <label>工具黑名单（PreToolUse 拦截，员工运行时生效）</label>
      <p class="tool-hint">勾选 = 禁用该工具（红线走 hooks 规则链，工具黑名单走 PreToolUse 拦截，两套机制互不干涉）</p>
      <div class="tools-grid">
        <div
          v-for="tool in ALL_TOOLS"
          :key="tool"
          class="tool-chip"
          :class="{ on: isToolDenied(tool), disabled: !redlinesEnabled }"
          :data-tool="tool"
          @click="toggleToolDeny(tool)"
        >
          <span class="tool-check">✕</span>{{ tool }}
        </div>
      </div>
      <div class="deny-preview" data-role="deny-preview">
        {{ deniedTools === 0 ? '无禁用工具' : `已禁 ${deniedTools} 个：${store.draft.deny.join('、')}` }}
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

/* 权限管理总开关 */
.master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--blue-50);
  border: 1px solid var(--blue-200);
  border-radius: 10px;
  margin-bottom: 14px;
}

.master-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  flex: 1;
}

.master-toggle input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  cursor: pointer;
  flex-shrink: 0;
}

.master-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.45;
}

.master-sub {
  display: block;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--g500);
  margin-top: 3px;
}

.master-count {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--blue-700);
  white-space: nowrap;
}

/* 分区禁用态（总开关关） */
.section-disabled {
  opacity: 0.45;
  pointer-events: none;
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

/* 工具黑名单 chip 区 */
.tool-hint {
  font-size: 12px;
  color: var(--g500);
  margin-bottom: 10px;
  line-height: 1.45;
}

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
  border-color: var(--red);
  color: var(--red);
}

.tool-chip.on {
  background: var(--red-bg);
  color: var(--red);
  border-color: var(--red);
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
  background: var(--red);
  border-color: var(--red);
}

.deny-preview {
  margin-top: 10px;
  font-size: 12px;
  color: var(--g500);
  font-family: Menlo, Consolas, monospace;
}
</style>
