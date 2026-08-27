<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import StepBar from '../components/wizard/StepBar.vue'
import PreviewPanel from '../components/wizard/PreviewPanel.vue'
import TplGrid from '../components/wizard/TplGrid.vue'
import StepAgent from '../components/wizard/steps/StepAgent.vue'
import StepCommandsFlow from '../components/wizard/steps/StepCommandsFlow.vue'
import StepConnectors from '../components/wizard/steps/StepConnectors.vue'
import StepHooksTools from '../components/wizard/steps/StepHooksTools.vue'
import StepKnowledge from '../components/wizard/steps/StepKnowledge.vue'
import StepSkills from '../components/wizard/steps/StepSkills.vue'
import { clearDraft, restoreDraft, saveDraft } from '../composables/useWizardDraft'
import type { TemplateMeta } from '../api/templates'
import { useWizardStore } from '../stores/wizard'

/**
 * 员工创建向导页（L1 员工新建线 Task 13 骨架 + Task 14 七步表单接入 + 草稿恢复 + Task 15 预览面板）：
 * - page-head：← 返回按钮（→ /employees）+ h1「员工创建」+ 副标；
 * - layout-2col：左栏「1 · 选择角色模板」+ TplGrid + 「2 · 配置向导」card
 *   （StepBar + 当前步骤组件区 + 底部 上一步/下一步 按钮）；
 * - 右栏 sticky PreviewPanel（校验徽章 + manifest YAML + 目录树——Task 15 实做）。
 *
 * 七步组件区（Task 14）：按 store.currentStep 切换 Step 组件——
 *   1 模板（左栏 TplGrid 已选）/ 2 Agent / 3 Skills / 4 HooksTools /
 *   5 CommandsFlow / 6 Knowledge / 7 Connectors。
 *
 * 草稿（Task 14）：watch draft deep → 防抖 1s 落 localStorage；onMounted 检测草稿 → 「检测到未完成草稿，恢复？」
 * 确认条（恢复/丢弃两按钮）；恢复时 local skill 项标 needsReupload:true。
 *
 * 预览面板跳转（Task 15）：PreviewPanel emit `jump-to-field {step, field}` → store.gotoStep(step)。
 *
 * 禁词红线（Global Constraint）：UI 文案全程不得出现「底座」「安装」「AgentHub」。
 */

const store = useWizardStore()
const router = useRouter()

/** 当前选中模板 id（透传 TplGrid 的 selectedId） */
const selectedId = computed(() => store.draft.selectedTemplateId)

/** 配置向导副标：基于当前选中模板 */
const wizardSubtitle = computed(() => {
  if (!selectedId.value) return '— 自定义员工'
  const tpl = store.templates.find((t) => t.id === selectedId.value)
  return tpl ? `— 基于「${tpl.display}」模板` : ''
})

/** 步级必填校验提示（step2 空 display/id 时显示） */
const stepValidationError = computed(() => {
  if (store.currentStep === 2) {
    if (store.draft.display.trim() === '') return '请填写岗位名称'
    if (store.draft.id.trim() === '') return '请填写员工 ID'
  }
  return ''
})

/** 草稿恢复提示 */
const draftPrompt = ref(false)
const restoredDraft = ref<ReturnType<typeof restoreDraft>>(null)

/** 草稿保存防抖 timer */
const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)

/** 监听 draft deep → 防抖 1s 落 localStorage */
watch(
  () => store.draft,
  (newDraft) => {
    saveDraft(newDraft, saveTimer)
  },
  { deep: true },
)

function goBack(): void {
  void router.push('/employees')
}

function onSelectTemplate(meta: TemplateMeta | null): void {
  store.selectTemplate(meta)
}

function onGoto(n: number): void {
  store.gotoStep(n)
}

function onNext(): void {
  store.next()
}

function onPrev(): void {
  store.prev()
}

/** PreviewPanel issue 点击 → 跳到对应 step */
function onJumpToField(payload: { step: number; field: string }): void {
  store.gotoStep(payload.step)
}

/** 恢复草稿 */
function onRestoreDraft(): void {
  if (!restoredDraft.value) return
  store.draft = { ...store.draft, ...restoredDraft.value }
  draftPrompt.value = false
  restoredDraft.value = null
}

/** 丢弃草稿 */
function onDiscardDraft(): void {
  clearDraft()
  draftPrompt.value = false
  restoredDraft.value = null
}

onMounted(async () => {
  await store.loadMeta()
  // 检测草稿
  const draft = restoreDraft()
  if (draft) {
    restoredDraft.value = draft
    draftPrompt.value = true
  }
})
</script>

<template>
  <section class="page-create">
    <header class="page-head">
      <div class="head-left">
        <button class="back-btn" type="button" aria-label="返回我的员工" @click="goBack">←</button>
        <div>
          <h1>员工创建</h1>
          <div class="sub">选择角色模板，通过配置向导生成符合 manifest schema 的员工包 —— 与手写同构，可 git 管理</div>
        </div>
      </div>
    </header>

    <!-- 草稿恢复提示条 -->
    <div v-if="draftPrompt" class="draft-banner">
      <span>检测到未完成草稿，是否恢复？</span>
      <div class="draft-actions">
        <button class="btn btn-primary btn-sm" type="button" @click="onRestoreDraft">恢复</button>
        <button class="btn btn-ghost btn-sm" type="button" @click="onDiscardDraft">丢弃</button>
      </div>
    </div>

    <div class="layout-2col">
      <div>
        <div class="section-title">1 · 选择角色模板</div>
        <TplGrid :templates="store.templates" :selected-id="selectedId" @select="onSelectTemplate" />

        <div class="section-title">2 · 配置向导 <span class="muted">{{ wizardSubtitle }}</span></div>
        <div class="card wizard-card">
          <StepBar :current-step="store.currentStep" @goto="onGoto" />

          <div class="step-area">
            <!-- Step 1 模板：左栏 TplGrid 已涵盖，此处提示文案 -->
            <p v-if="store.currentStep === 1" class="step-hint">请在上方选择角色模板，然后点「下一步」开始配置。</p>

            <!-- Step 2 Agent 定义 -->
            <StepAgent v-else-if="store.currentStep === 2" />

            <!-- Step 3 Skills -->
            <StepSkills v-else-if="store.currentStep === 3" />

            <!-- Step 4 Hooks 与 Tools -->
            <StepHooksTools v-else-if="store.currentStep === 4" />

            <!-- Step 5 Commands 与流程 -->
            <StepCommandsFlow v-else-if="store.currentStep === 5" />

            <!-- Step 6 Knowledge -->
            <StepKnowledge v-else-if="store.currentStep === 6" />

            <!-- Step 7 Connectors -->
            <StepConnectors v-else-if="store.currentStep === 7" />

            <p v-if="stepValidationError" class="step-error">{{ stepValidationError }}</p>
          </div>

          <div class="wizard-foot">
            <button class="btn btn-ghost" type="button" :disabled="store.currentStep <= 1" @click="onPrev">上一步</button>
            <button class="btn btn-primary" type="button" :disabled="store.currentStep >= 7" @click="onNext">下一步</button>
          </div>
        </div>
      </div>

      <!-- 右栏：sticky 预览面板（Task 15 实做） -->
      <div class="preview-col">
        <PreviewPanel @jump-to-field="onJumpToField" />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 原型 .page-head：标题区 + 下间距 18px */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
}

.head-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.sub {
  color: var(--g500);
  margin-top: 5px;
  font-size: 13px;
}

/* 原型 .back-btn */
.back-btn {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid var(--g300);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--g600);
  margin-top: 5px;
  flex-shrink: 0;
}

.back-btn:hover {
  border-color: var(--blue-400);
  color: var(--blue-700);
}

/* 草稿恢复提示条 */
.draft-banner {
  background: var(--blue-50);
  border: 1px solid var(--blue-200);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--blue-800);
}

.draft-actions {
  display: flex;
  gap: 8px;
}

/* 原型 .layout-2col */
.layout-2col {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 20px;
  align-items: start;
}

/* 原型 .section-title */
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin: 26px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title::before {
  content: '';
  width: 4px;
  height: 15px;
  border-radius: 2px;
  background: var(--blue-500);
}

.section-title:first-of-type {
  margin-top: 0;
}

.muted {
  color: var(--g500);
  font-size: 12px;
  font-weight: 400;
}

/* 原型 .card */
.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.wizard-card {
  padding: 22px;
}

/* 步骤组件区 */
.step-area {
  min-height: 120px;
  padding: 12px 0;
}

.step-hint {
  color: var(--g500);
  font-size: 13px;
  margin: 0 0 8px;
}

.step-error {
  color: var(--red);
  font-size: 12.5px;
  margin: 8px 0 0;
}

.wizard-foot {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  justify-content: flex-end;
}

/* 原型 .btn 通用 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  font-weight: 500;
  font-family: inherit;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 12px;
  border-radius: 7px;
}

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:not(:disabled):hover {
  background: var(--blue-700);
}

.btn-ghost {
  background: #fff;
  border-color: var(--g300);
  color: var(--g700);
}

.btn-ghost:not(:disabled):hover {
  border-color: var(--blue-400);
  color: var(--blue-700);
}

/* 右栏 sticky 预览面板 */
.preview-col {
  position: sticky;
  top: 20px;
}

.panel {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 18px;
}

.panel h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
</style>
