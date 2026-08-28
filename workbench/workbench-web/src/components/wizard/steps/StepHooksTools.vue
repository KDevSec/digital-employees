<script setup lang="ts">
import { ref } from 'vue'

import { useWizardStore } from '../../../stores/wizard'

/**
 * Step 4 · Hooks 与 Tools 约束（L1 员工新建线 Task 14）：
 * - 红线 check-grid（7 rule_id + 中文自然语言描述）；
 * - tools.deny 折叠说明（V0.1 空）；
 * - 折叠区「高级设置」：tier 五档 radio-cards + Token 配额两 input + 可见性/审计/治理级别 select。
 *
 * 红线 7 项（spec §7 表④）：
 *   no-push-to-main / high-risk-via-gate / no-devzero-state / no-external-request /
 *   no-production-access / no-db-schema / custom（disabled 占位）
 *
 * tier 五档：评审安全档 / 设计档 / 探索档 / 编码档 / 执行档
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 * 「.devzero 状态」红线描述：spec 原文用「.devzero 状态」，本组件用「.devzero 状态」（无禁词冲突）。
 */

const store = useWizardStore()
const advancedOpen = ref(false)

/** 红线 7 项 */
interface RedlineOption {
  rule_id: string
  label: string
  disabled?: boolean
}

const REDLINES: RedlineOption[] = [
  { rule_id: 'no-push-to-main', label: '禁止直接 push 到 main' },
  { rule_id: 'high-risk-via-gate', label: '高风险操作走人工闸' },
  { rule_id: 'no-devzero-state', label: '不改动 .devzero 状态' },
  { rule_id: 'no-external-request', label: '禁止外网请求' },
  { rule_id: 'no-production-access', label: '禁止生产环境访问' },
  { rule_id: 'no-db-schema', label: '禁止改库表结构' },
  { rule_id: 'custom', label: '自定义红线（V0.2 开放）', disabled: true },
]

/**
 * tier 五档（值 = manifestSchema 的中文枚举，直接透传 buildManifestFromDraft 不需映射）：
 *   '评审安全档' / '设计档' / '探索档' / '编码档' / '执行档'
 * label 直接复用枚举值（schema 枚举本身即中文），sub 补充语义说明。
 */
const TIERS = [
  { value: '评审安全档', label: '评审安全档', sub: '高风险评审 + 安全审计节点' },
  { value: '设计档', label: '设计档', sub: '架构设计与方案评审节点' },
  { value: '探索档', label: '探索档', sub: '调研与原型探索节点' },
  { value: '编码档', label: '编码档', sub: '常规编码 + 自测节点' },
  { value: '执行档', label: '执行档', sub: '轻量执行 + 通报节点' },
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

/** tier 切换 */
function selectTier(value: string): void {
  store.draft.tier = value
}

/** 可见性选项 */
const VISIBILITIES = [
  { value: 'private', label: '仅自己' },
  { value: 'team', label: '团队内' },
  { value: 'department', label: '部门内' },
  { value: 'company', label: '全公司' },
]

/** 审计级别 */
const AUDITS = [
  { value: 'full', label: '全量记录' },
  { value: 'exceptions-only', label: '仅异常记录' },
  { value: 'off', label: '可关闭' },
]

/** 治理级别 */
const GOVERNANCE_LEVELS = ['L1', 'L2', 'L3', 'L4']
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
      <label>工具禁用（tools.deny）</label>
      <div class="hint-box">V0.1 阶段 tools.deny 默认空——红线编译时由 hooks 编译器自动生成对应 PreToolUse 拦截规则。</div>
    </div>

    <!-- 折叠区「高级设置」 -->
    <div class="advanced-section">
      <button
        type="button"
        class="advanced-toggle"
        data-role="advanced-toggle"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        {{ advancedOpen ? '▾' : '▸' }} 高级设置（治理与配额）
      </button>

      <div v-if="advancedOpen" class="advanced-body">
        <div class="form-row">
          <label>模型档位（写入 tier-map，按节点类型分档）</label>
          <div class="radio-cards">
            <div
              v-for="t in TIERS"
              :key="t.value"
              class="radio-card"
              :class="{ on: store.draft.tier === t.value }"
              data-tier
              @click="selectTier(t.value)"
            >
              <div class="rc-name">{{ t.label }}</div>
              <div class="rc-sub">{{ t.sub }}</div>
            </div>
          </div>
        </div>

        <div class="form-row-pair">
          <div class="form-row">
            <label>单任务 Token 上限</label>
            <input
              class="input"
              type="number"
              data-field="tokenPerTask"
              :value="store.draft.tokenPerTask ?? ''"
              placeholder="例如：500000"
              @input="store.draft.tokenPerTask = Number(($event.target as HTMLInputElement).value) || undefined"
            />
          </div>
          <div class="form-row">
            <label>月度 Token 上限</label>
            <input
              class="input"
              type="number"
              data-field="tokenMonthly"
              :value="store.draft.tokenMonthly ?? ''"
              placeholder="例如：20000000"
              @input="store.draft.tokenMonthly = Number(($event.target as HTMLInputElement).value) || undefined"
            />
          </div>
        </div>

        <div class="form-row-pair">
          <div class="form-row">
            <label>可见范围（写入 governance.visibility）</label>
            <select
              class="select"
              data-field="visibility"
              :value="store.draft.visibility"
              @change="store.draft.visibility = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="v in VISIBILITIES" :key="v.value" :value="v.value">{{ v.label }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>审计级别（写入 governance.audit）</label>
            <select
              class="select"
              data-field="audit"
              :value="store.draft.audit"
              @change="store.draft.audit = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="a in AUDITS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <label>治理级别（写入 governance.level）</label>
          <div class="radio-cards radio-cards-4">
            <div
              v-for="lvl in GOVERNANCE_LEVELS"
              :key="lvl"
              class="radio-card"
              :class="{ on: store.draft.governanceLevel === lvl }"
              data-governance-level
              @click="store.draft.governanceLevel = lvl"
            >
              <div class="rc-name">{{ lvl }}</div>
            </div>
          </div>
        </div>
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

.form-row-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 22px;
}

.input,
.select {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  background: #fff;
}

.input:focus,
.select:focus {
  border-color: var(--blue-500);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.hint-box {
  background: var(--g100);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--g600);
  line-height: 1.55;
}

/* check-grid */
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

/* 折叠区 */
.advanced-section {
  margin-top: 8px;
}

.advanced-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--g700);
  padding: 6px 0;
  font-family: inherit;
}

.advanced-toggle:hover {
  color: var(--blue-700);
}

.advanced-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--g100);
}

/* radio-cards */
.radio-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
}

.radio-cards-4 {
  grid-template-columns: repeat(4, 1fr);
}

.radio-card {
  border: 1.5px solid var(--g200);
  border-radius: 10px;
  padding: 11px;
  cursor: pointer;
  text-align: center;
  transition: 0.12s;
}

.radio-card.on {
  border-color: var(--blue-600);
  background: var(--blue-50);
}

.rc-name {
  font-weight: 600;
  font-size: 13px;
}

.rc-sub {
  font-size: 11px;
  color: var(--g500);
  margin-top: 3px;
}
</style>
