<script setup lang="ts">
import { watch } from 'vue'

import { slugify } from '../../../composables/useWizardDraft'
import { useWizardStore } from '../../../stores/wizard'

/**
 * Step 2 · Agent 定义（L1 员工新建线 Task 14）：
 * - 岗位名 input（draft.display）/ 员工 ID input（draft.id，mono 字体）；
 * - 头像选择：12 emoji 池（demo AVATARS 同源 + 图标字兜底）；
 * - 职责描述 textarea（persona.identity）；
 * - 工作原则 textarea（每行一条 → persona.principles）；
 * - 使用深度 check-grid 四档（裸用/+方法论/+流程/+编排 → persona.usage_modes）。
 *
 * slug 联动：watch display → !idTouched 才同步 draft.id（slugify 后）；
 * id 输入手改 → idTouched=true 停跟。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */

const store = useWizardStore()

/** 头像 emoji 池（12 个，demo AVATARS 同源） */
const AVATARS = ['🧑‍💻', '👩‍💻', '🧑‍🔬', '🧑‍🎨', '🧑‍🏫', '⚖️', '🕵️', '🧙', '🤖', '🦾', '🐱', '🦊'] as const

/** 使用深度四档 */
const USAGE_MODES = [
  { value: 'bare', label: '裸用（直接对话）' },
  { value: 'methodology', label: '+方法论（skill 调用序列）' },
  { value: 'flow', label: '+流程（runbook 流程档）' },
  { value: 'orchestration', label: '+编排（node-table 多员工接力）' },
] as const

/** 工作原则文本（每行一条） */
function principlesText(): string {
  return store.draft.principles.join('\n')
}

function onPrinciplesInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  store.draft.principles = value.split('\n').map((s) => s.trim()).filter((s) => s !== '')
}

/** usage_modes 勾选态 */
function isUsageModeOn(mode: string): boolean {
  return store.draft.usage_modes.includes(mode)
}

function toggleUsageMode(mode: string): void {
  if (isUsageModeOn(mode)) {
    store.draft.usage_modes = store.draft.usage_modes.filter((m) => m !== mode)
  } else {
    store.draft.usage_modes = [...store.draft.usage_modes, mode]
  }
}

/** slug 联动：display 改 → 未 touched 才同步 id */
watch(
  () => store.draft.display,
  (newDisplay) => {
    if (store.draft.idTouched) return
    store.draft.id = slugify(newDisplay)
  },
)

/** id 手改 → touched=true 停跟 */
function onIdInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  store.draft.id = value
  store.draft.idTouched = true
}

/** display 输入 → 同步 store.draft.display（触发 watch 同步 id） */
function onDisplayInput(event: Event): void {
  store.draft.display = (event.target as HTMLInputElement).value
}

/** identity textarea 同步 */
function onIdentityInput(event: Event): void {
  store.draft.identity = (event.target as HTMLTextAreaElement).value
}
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">🪪</span> 身份 —— 员工是谁</div>

    <div class="form-row-pair">
      <div class="form-row">
        <label>岗位名称 <span class="req">*</span></label>
        <input class="input" data-field="display" :value="store.draft.display" placeholder="例如：前端开发工程师" @input="onDisplayInput" />
      </div>
      <div class="form-row">
        <label>员工 ID <span class="req">*</span></label>
        <input class="input id-input" data-field="id" :value="store.draft.id" placeholder="auto-generated" @input="onIdInput" />
      </div>
    </div>

    <div class="form-row">
      <label>头像</label>
      <div class="avatar-row">
        <button
          v-for="emoji in AVATARS"
          :key="emoji"
          type="button"
          class="avatar-pick"
          :class="{ on: store.draft.avatar === emoji }"
          data-avatar
          @click="store.draft.avatar = emoji"
        >{{ emoji }}</button>
      </div>
    </div>

    <div class="form-row">
      <label>职责描述（写入 persona.identity）</label>
      <textarea class="textarea" data-field="identity" :value="store.draft.identity" placeholder="员工的核心职责与专长" @input="onIdentityInput"></textarea>
    </div>

    <div class="form-row">
      <label>工作原则（写入 persona.principles，每行一条）</label>
      <textarea
        class="textarea"
        data-field="principles"
        :value="principlesText()"
        placeholder="例如：增量交付，小步迭代"
        @input="onPrinciplesInput"
      ></textarea>
    </div>

    <div class="form-row">
      <label>使用深度（写入 persona.usage_modes）</label>
      <div class="check-grid">
        <div
          v-for="mode in USAGE_MODES"
          :key="mode.value"
          class="check-item"
          :class="{ on: isUsageModeOn(mode.value) }"
          @click="toggleUsageMode(mode.value)"
        >
          <span class="box">✓</span>{{ mode.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原型 .cat-section：分类段，下边虚线分隔 */
.cat-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--g200);
}

.cat-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
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

/* 原型 .form-row */
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

.req {
  color: var(--red);
}

.form-row-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 22px;
}

/* 原型 .input/.textarea */
.input,
.textarea {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  transition: 0.15s;
  background: #fff;
}

.input:focus,
.textarea:focus {
  border-color: var(--blue-500);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.id-input {
  font-family: Menlo, Consolas, monospace;
}

.textarea {
  min-height: 76px;
  resize: vertical;
  line-height: 1.55;
}

/* 头像选择行 */
.avatar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.avatar-pick {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  border: 1.5px solid var(--g200);
  background: #fff;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: 0.12s;
}

.avatar-pick:hover {
  border-color: var(--blue-300);
}

.avatar-pick.on {
  border-color: var(--blue-500);
  background: var(--blue-50);
  box-shadow: 0 0 0 2px var(--blue-100);
}

/* 原型 .check-grid */
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
</style>
