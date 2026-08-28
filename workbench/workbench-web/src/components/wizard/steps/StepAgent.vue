<script setup lang="ts">
import { watch } from 'vue'

import { slugify } from '../../../composables/useWizardDraft'
import { useWizardStore } from '../../../stores/wizard'

/**
 * Step 2 · Agent 定义（L1 员工新建线 Task 14 + 2026-08-28 UX 迭代）：
 * - 岗位名 input（draft.display）/ 员工 ID input（draft.id，mono 字体）；
 * - 一句话职责 input（draft.brief）；
 * - 头像选择：12 emoji 池（demo AVATARS 同源 + 图标字兜底）；
 * - 职责描述 textarea（persona.identity）；
 * - 工作原则 textarea（每行一条 → persona.principles）。
 *
 * 2026-08-28 裁决：「使用深度」UI 移除（用户难以理解且非独立配置项），
 * usage_modes 由 store 静默注入 ['裸用']（kind 分派保底）。
 *
 * slug 联动：watch display → !idTouched 才同步 draft.id（slugify 后）；
 * id 输入手改 → idTouched=true 停跟。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */

const store = useWizardStore()

/** 头像 emoji 池（12 个，demo AVATARS 同源） */
const AVATARS = ['🧑‍💻', '👩‍💻', '🧑‍🔬', '🧑‍🎨', '🧑‍🏫', '⚖️', '🕵️', '🧙', '🤖', '🦾', '🐱', '🦊'] as const

/** 工作原则文本（每行一条） */
function principlesText(): string {
  return store.draft.principles.join('\n')
}

function onPrinciplesInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  store.draft.principles = value.split('\n').map((s) => s.trim()).filter((s) => s !== '')
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
      <label>一句话职责（写入 brief）</label>
      <input class="input" data-field="brief" :value="store.draft.brief" placeholder="如：承接前端需求的实现与联调" @input="store.draft.brief = ($event.target as HTMLInputElement).value" />
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
</style>
