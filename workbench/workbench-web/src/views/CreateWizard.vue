<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import StepBar from '../components/wizard/StepBar.vue'
import TplGrid from '../components/wizard/TplGrid.vue'
import { useWizardStore } from '../stores/wizard'

/**
 * 员工创建向导页（L1 员工新建线 Task 13 骨架）：
 * - page-head：← 返回按钮（→ /employees）+ h1「员工创建」+ 副标；
 * - layout-2col：左栏「1 · 选择角色模板」section-title + TplGrid + 「2 · 配置向导」card
 *   （StepBar + 当前步骤组件区 + 底部 上一步/下一步 按钮）；
 * - 右栏 sticky 预览面板占位（「产出物预览」——Task 15 实做）。
 *
 * 步骤组件区：本任务先空壳（按 currentStep 显示提示文案）；Task 14 接入七个 Step 组件按 currentStep 切换。
 *
 * 禁词红线（Global Constraint）：UI 文案全程不得出现「底座」「安装」「AgentHub」。
 * 「上传到 AgentHub」按钮不实现（原型有该按钮，本任务按禁词红线删去）。
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

/** 当前步骤提示文案（Task 14 接入实际组件前的占位） */
const stepHint = computed(() => {
  switch (store.currentStep) {
    case 1:
      return '请在上方选择角色模板，然后点「下一步」开始配置。'
    case 2:
      return 'Step 2：Agent 定义（Task 14 实做）'
    case 3:
      return 'Step 3：Skills 能力配置（Task 14 实做）'
    case 4:
      return 'Step 4：Hooks 与 Tools 约束（Task 14 实做）'
    case 5:
      return 'Step 5：Commands 与流程（Task 14 实做）'
    case 6:
      return 'Step 6：Knowledge（Task 14 实做）'
    case 7:
      return 'Step 7：Connectors MCP（Task 14 实做）'
    default:
      return ''
  }
})

/** 步级必填校验提示（step2 空 display/id 时显示） */
const stepValidationError = computed(() => {
  if (store.currentStep === 2) {
    if (store.draft.display.trim() === '') return '请填写岗位名称'
    if (store.draft.id.trim() === '') return '请填写员工 ID'
  }
  return ''
})

function goBack(): void {
  void router.push('/employees')
}

function onSelectTemplate(meta: import('../api/templates').TemplateMeta | null): void {
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

onMounted(() => {
  void store.loadMeta()
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

    <div class="layout-2col">
      <div>
        <div class="section-title">1 · 选择角色模板</div>
        <TplGrid :templates="store.templates" :selected-id="selectedId" @select="onSelectTemplate" />

        <div class="section-title">2 · 配置向导 <span class="muted">{{ wizardSubtitle }}</span></div>
        <div class="card wizard-card">
          <StepBar :current-step="store.currentStep" @goto="onGoto" />

          <div class="step-area">
            <p class="step-hint">{{ stepHint }}</p>
            <p v-if="stepValidationError" class="step-error">{{ stepValidationError }}</p>
          </div>

          <div class="wizard-foot">
            <button class="btn btn-ghost" type="button" :disabled="store.currentStep <= 1" @click="onPrev">上一步</button>
            <button class="btn btn-primary" type="button" :disabled="store.currentStep >= 7" @click="onNext">下一步</button>
          </div>
        </div>
      </div>

      <!-- 右栏：sticky 预览面板占位（Task 15 实做） -->
      <div class="preview-col">
        <div class="panel">
          <h3>产出物预览</h3>
          <div class="muted">向导产出与手写完全同构，符合 manifest schema（Task 15 实做）</div>
        </div>
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

/* 原型 .back-btn：返回按钮 */
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

/* 原型 .layout-2col：1fr + 340px */
.layout-2col {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 20px;
  align-items: start;
}

/* 原型 .section-title：蓝竖条 + 15px 600 */
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

/* 原型 .card：白卡 */
.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.wizard-card {
  padding: 22px;
}

/* 步骤组件区：Task 14 接入实际组件前的占位 */
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
  margin: 0;
}

/* 底部按钮区 */
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
