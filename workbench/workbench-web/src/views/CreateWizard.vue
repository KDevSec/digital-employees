<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import StepBar from '../components/wizard/StepBar.vue'
import CompletionPanel from '../components/wizard/CompletionPanel.vue'
import PreviewPanel from '../components/wizard/PreviewPanel.vue'
import TplGrid from '../components/wizard/TplGrid.vue'
import StepAgent from '../components/wizard/steps/StepAgent.vue'
import StepConnectors from '../components/wizard/steps/StepConnectors.vue'
import StepExtensions from '../components/wizard/steps/StepExtensions.vue'
import StepHooksTools from '../components/wizard/steps/StepHooksTools.vue'
import StepSkills from '../components/wizard/steps/StepSkills.vue'
import { generateEmployee } from '../api/employees'
import type { GenerateResult } from '../api/employees'
import { clearDraft, flushDraft, restoreDraft, saveDraft } from '../composables/useWizardDraft'
import type { TemplateMeta } from '../api/templates'
import { useWizardStore } from '../stores/wizard'

/**
 * 员工创建向导页（L1 员工新建线 Task 13 骨架 + Task 14 七步表单接入 + 草稿恢复 + Task 15 预览面板 +
 * Task 16 生成与完成态）：
 * - page-head：← 返回按钮（→ /employees）+ h1「员工创建」+ 副标；
 * - layout-2col：左栏「1 · 选择角色模板」+ TplGrid + 「2 · 配置向导」card
 *   （StepBar + 当前步骤组件区 + 底部 上一步/下一步/生成员工包 按钮）；
 * - 右栏 sticky PreviewPanel（校验徽章 + manifest YAML + 目录树）。
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
 * 生成动作（Task 16）：step7 底部「生成员工包」按钮 → generateEmployee 三态处理：
 *   200 → CompletionPanel（包路径+files+三动作）+ clearDraft()；
 *   422 VALIDATION_FAILED → gotoStep(第一个 issue 的 step)；
 *   409 ID_CONFLICT → step2 + id 输入区红字「ID 已被占用」提示；
 *   422 SKILL_MISSING → toast 错误信息（提示重传）。
 *
 * 禁词红线（Global Constraint）：UI 文案全程不得出现「底座」「安装」「AgentHub」（CompletionPanel
 * 完成态显式「安装到底座」动作文案除外）。
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

/** 生成状态：idle/pending/ok/err */
const generating = ref(false)
const genResult = ref<GenerateResult | null>(null)
/** ID_CONFLICT 红字提示（step2 id 输入区下方） */
const idConflictMsg = ref('')
/** toast 文案（SKILL_MISSING 等错误提示） */
const toastText = ref('')
const toastVisible = ref(false)

function showToast(text: string): void {
  toastText.value = text
  toastVisible.value = true
  setTimeout(() => {
    toastVisible.value = false
  }, 4000)
}

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

/** 生成员工包——三态处理 */
async function onGenerate(): Promise<void> {
  if (generating.value) return
  generating.value = true
  idConflictMsg.value = ''
  try {
    const result = await generateEmployee(store.draft)
    genResult.value = result
    clearDraft()
  } catch (err) {
    const e = err as { code?: string; field_errors?: Array<{ step: number; field: string; message: string }>; message?: string }
    if (e.code === 'VALIDATION_FAILED' && e.field_errors && e.field_errors.length > 0) {
      // 跳到第一个 issue 的 step
      store.gotoStep(e.field_errors[0].step)
    } else if (e.code === 'ID_CONFLICT') {
      idConflictMsg.value = 'ID 已被占用'
      store.gotoStep(2)
    } else if (e.code === 'SKILL_MISSING') {
      showToast(e.message ?? 'skill 素材缺失，需重新上传')
    } else {
      showToast(e.message ?? '生成失败')
    }
  } finally {
    generating.value = false
  }
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

/**
 * F4：unmount flush——离开页面时立即落键（清除 pending 防抖 timer + 同步写 localStorage）。
 * 防止用户在 draft 变更后 ≤1s 内离开页面丢失最后一段编辑（防抖 timer 还未触发就 unmount）。
 * 仅在未生成成功时 flush（生成成功已 clearDraft，无需再写）。
 */
onBeforeUnmount(() => {
  if (genResult.value) return
  flushDraft(store.draft, saveTimer)
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
        <div class="section-title">配置向导 <span class="muted">{{ wizardSubtitle }}</span></div>
        <div class="card wizard-card">
          <StepBar :current-step="store.currentStep" @goto="onGoto" />

          <!-- 生成成功 → 完成态视图替代步骤区 -->
          <CompletionPanel
            v-if="genResult"
            :package-path="genResult.package_path"
            :files="genResult.files"
          />

          <template v-else>
            <div class="step-area">
              <!-- Step 1 模板：TplGrid 移入 step 区域（不再常驻上方） -->
              <TplGrid
                v-if="store.currentStep === 1"
                :templates="store.templates"
                :selected-id="selectedId"
                @select="onSelectTemplate"
              />

              <!-- Step 2 Agent定义 -->
              <StepAgent v-else-if="store.currentStep === 2" />

              <!-- Step 3 Skills -->
              <StepSkills v-else-if="store.currentStep === 3" />

              <!-- Step 4 约束Hook -->
              <StepHooksTools v-else-if="store.currentStep === 4" />

              <!-- Step 5 连接器MCP -->
              <StepConnectors v-else-if="store.currentStep === 5" />

              <!-- Step 6 其他（五轻 chip 折叠区） -->
              <StepExtensions v-else-if="store.currentStep === 6" />

              <p v-if="stepValidationError" class="step-error">{{ stepValidationError }}</p>
              <p v-if="idConflictMsg && store.currentStep === 2" class="step-error" data-role="id-conflict">{{ idConflictMsg }}</p>
            </div>

            <div class="wizard-foot">
              <button class="btn btn-ghost" type="button" :disabled="store.currentStep <= 1" @click="onPrev">上一步</button>
              <button
                v-if="store.currentStep < 6"
                class="btn btn-primary"
                type="button"
                @click="onNext"
              >下一步</button>
              <button
                v-else
                class="btn btn-primary"
                type="button"
                :disabled="generating"
                data-role="generate-btn"
                @click="onGenerate"
              >{{ generating ? '生成中…' : '生成员工包' }}</button>
            </div>
          </template>
        </div>
      </div>

      <!-- 右栏：sticky 预览面板（Task 15 实做） -->
      <div class="preview-col">
        <PreviewPanel @jump-to-field="onJumpToField" />
      </div>
    </div>

    <!-- toast -->
    <div v-if="toastVisible" class="toast" data-role="toast">{{ toastText }}</div>
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
