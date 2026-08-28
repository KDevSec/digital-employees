<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { fetchBases, probeBases, type BaseCard, type BaseId } from '../../api/bases'
import {
  executeDeployment,
  planDeployment,
  verifyDeployment,
  type DeploymentPlanResult,
  type DriftItem,
  type InstallReport,
} from '../../api/installs'

/**
 * InstallModal（L1 员工新建线 Task 23 / W6 追加）：
 * 消费 bases 域真实检测 + L2 deployments 三步链——
 * ① 底座选择步：onMounted fetchBases → 卡片列表（present=true 可选；false 灰置 + 「未检测到」标注；
 *    顶部「重新探测」按钮 → probeBases pending 态 → 刷新列表）
 * ② 确认步：所选底座清单 + 别名可选
 * ③ 执行步：依次 plan（展示落位清单）→ execute（执行中）→ verify（校验和）；每步真实状态/真实错误展示，
 *    失败可重试当前步；全链完成显示安装报告摘要（execute 响应的落位清单/报告字段）
 *
 * 「安装服务待接入」提示态删除（端点已真实存在——失败展示真实错误，不走提示态兜底假成功）。
 *
 * 禁词红线：本组件是完成态显式「安装到底座」动作承载——「安装」字样在本组件允许出现；
 * 但不得出现「AgentHub」「digital-staff」等其他禁词。
 *
 * 员工级不选模型（D-046）——弹层无模型清单。
 * 页面零假数据：底座数据纯 bases API（无静态数组残留）。
 */

const props = defineProps<{
  /** 员工 ID（生成成功后传入 = manifest.id） */
  employeeId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 底座卡片清单（GET /api/bases 拉取；空数组 = 调用方未就绪或无在场） */
const baseCards = ref<BaseCard[]>([])
/** 探测 pending（「重新探测」按钮点击中） */
const probePending = ref(false)

/** 当前步骤（1 选择 / 2 确认 / 3 执行） */
const step = ref<1 | 2 | 3>(1)

/** 已选底座 id 集合 */
const selectedBaseIds = ref<Set<BaseId>>(new Set())

/** 别名（按 base id 索引，可选） */
const aliases = ref<Partial<Record<BaseId, string>>>({})

/** 单底座执行链状态 */
interface BaseInstallState {
  base: BaseId
  label: string
  /** 当前阶段：plan（落位预览）→ executing（执行中）→ verifying（校验和）→ success / failed */
  phase: 'plan' | 'executing' | 'verifying' | 'success' | 'failed'
  plan?: DeploymentPlanResult
  report?: InstallReport
  drift?: DriftItem[]
  error?: { code: string; message: string }
}
/** 三步链状态机（按所选底座顺序） */
const installStates = ref<BaseInstallState[]>([])

/** 是否有失败步（控制重试按钮显隐） */
const hasFailed = computed(() => installStates.value.some((s) => s.phase === 'failed'))
/** 是否全部成功（控制关闭按钮在 ③ 步的优先文案） */
const allSuccess = computed(() => installStates.value.length > 0 && installStates.value.every((s) => s.phase === 'success'))

onMounted(async () => {
  baseCards.value = await fetchBases()
})

/** 已选底座对象清单（确认页渲染） */
const selectedCards = computed(() => baseCards.value.filter((c) => selectedBaseIds.value.has(c.id)))

/**
 * 切换底座勾选——不在场卡不可「新勾选」，但允许反选「已选-but-now-absent」的底座
 * （配合 reprobe 自动过滤——防御 reprobe 漏过滤时仍可手动反选，避免 disabled+on 卡死不可点击）
 */
function toggleBase(card: BaseCard): void {
  if (!card.present && !selectedBaseIds.value.has(card.id)) return
  const next = new Set(selectedBaseIds.value)
  if (next.has(card.id)) next.delete(card.id)
  else next.add(card.id)
  selectedBaseIds.value = next
}

/** 重新探测——POST /api/bases/probe（缺省全刷）+ GET /api/bases 刷新列表 + 过滤滞留选中 */
async function reprobe(): Promise<void> {
  if (probePending.value) return
  probePending.value = true
  try {
    await probeBases()
    baseCards.value = await fetchBases()
    // 刷新后过滤 selectedBaseIds——仅保留仍 present 的 id（防滞留：reprobe 前选中、reprobe 后变 absent 的底座不应滞留）
    const stillPresent = new Set(baseCards.value.filter((c) => c.present).map((c) => c.id))
    const filtered = new Set<BaseId>()
    for (const id of selectedBaseIds.value) {
      if (stillPresent.has(id)) filtered.add(id)
    }
    selectedBaseIds.value = filtered
  } finally {
    probePending.value = false
  }
}

/** 下一步：选择 → 确认（至少选一个） */
function goConfirm(): void {
  if (selectedBaseIds.value.size === 0) return
  step.value = 2
}

/** 返回上一步 */
function back(): void {
  if (step.value === 2) step.value = 1
}

/** 开始安装——初始化每个所选底座的状态，进入执行步并启动三步链 */
async function startInstall(): Promise<void> {
  installStates.value = selectedCards.value.map((c) => ({
    base: c.id,
    label: c.label,
    phase: 'plan',
  }))
  step.value = 3
  await runChain()
}

/**
 * 三步链顺序执行：plan → execute → verify（每步失败停止；后续重试从失败步起继续）。
 * 跳过已 success 的 base（重试时不重做）。
 */
async function runChain(): Promise<void> {
  for (const state of installStates.value) {
    if (state.phase === 'success') continue
    try {
      // plan：干跑——展示落位清单 + 协商结论
      state.phase = 'plan'
      state.error = undefined
      state.plan = await planDeployment(props.employeeId, state.base)
      // execute：执行安装
      state.phase = 'executing'
      state.report = await executeDeployment(props.employeeId, state.base)
      if (state.report.result === 'failed') {
        // execute 200 但报告 result=failed（service 内部失败——如 negotiate blocked / execute error）
        state.phase = 'failed'
        state.error = state.report.error
          ? { code: state.report.error.code, message: state.report.error.message }
          : { code: 'INSTALL_FAILED', message: '安装失败（执行阶段）' }
        return
      }
      // verify：校验和
      state.phase = 'verifying'
      const v = await verifyDeployment(props.employeeId, state.base)
      state.drift = v.drift
      state.phase = 'success'
    } catch (e) {
      state.phase = 'failed'
      const err = e as { code?: string; message?: string }
      state.error = {
        code: err.code ?? 'UNKNOWN',
        message: err.message ?? '请求失败',
      }
      return
    }
  }
}

/** 重试当前失败步：从失败的 base 处重置并继续 runChain */
async function retry(): Promise<void> {
  const failedIdx = installStates.value.findIndex((s) => s.phase === 'failed')
  if (failedIdx === -1) return
  // 重置失败步及之后的状态——保留 success 步不重做
  for (let i = failedIdx; i < installStates.value.length; i++) {
    installStates.value[i].phase = 'plan'
    installStates.value[i].error = undefined
    installStates.value[i].plan = undefined
    installStates.value[i].report = undefined
    installStates.value[i].drift = undefined
  }
  await runChain()
}

/** 阶段中文标签 */
function phaseLabel(phase: BaseInstallState['phase']): string {
  const labels: Record<BaseInstallState['phase'], string> = {
    plan: '落位预览',
    executing: '执行中',
    verifying: '校验和',
    success: '已完成',
    failed: '失败',
  }
  return labels[phase]
}

/** 关闭弹层 */
function close(): void {
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" data-role="modal-backdrop" @click.self="close">
    <div class="modal" data-role="install-modal">
      <div class="modal-head">
        <h3>安装到底座</h3>
        <button type="button" class="close-btn" aria-label="关闭" @click="close">✕</button>
      </div>

      <!-- ① 底座选择 -->
      <div v-if="step === 1" class="modal-body">
        <div class="probe-row">
          <button
            type="button"
            class="btn btn-ghost"
            data-role="probe-btn"
            :disabled="probePending"
            @click="reprobe"
          >{{ probePending ? '探测中…' : '重新探测' }}</button>
        </div>
        <div v-if="baseCards.length === 0" class="empty-hint" data-role="empty-hint">
          {{ probePending ? '正在检测底座…' : '未检测到任何底座' }}
        </div>
        <template v-else>
          <div class="step-hint">选择目标底座（可多选）</div>
          <div class="host-grid">
            <div
              v-for="c in baseCards"
              :key="c.id"
              class="host-card"
              :class="{ on: selectedBaseIds.has(c.id), disabled: !c.present }"
              data-role="base-card"
              :data-present="c.present ? 'true' : 'false'"
              @click="toggleBase(c)"
            >
              <div class="host-icon">📦</div>
              <div class="host-name">{{ c.label }}</div>
              <div class="host-id">{{ c.id }}</div>
              <div v-if="!c.present" class="host-status" data-role="absent-label">未检测到</div>
              <div v-else class="host-version">{{ c.version ?? '未知版本' }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- ② 确认页 -->
      <div v-else-if="step === 2" class="modal-body">
        <div class="step-hint">确认安装到以下底座：</div>
        <ul class="confirm-list">
          <li v-for="c in selectedCards" :key="c.id" data-role="confirm-host-item">
            <div class="confirm-host-row">
              <span class="confirm-name">{{ c.label }}</span>
              <input
                class="alias-input"
                type="text"
                :placeholder="`别名（可选，默认 ${employeeId}）`"
                :value="aliases[c.id] ?? ''"
                @input="aliases[c.id] = ($event.target as HTMLInputElement).value"
              />
            </div>
          </li>
        </ul>
      </div>

      <!-- ③ 执行步——每所选底座一行状态机 -->
      <div v-else class="modal-body">
        <div v-for="s in installStates" :key="s.base" class="install-row" data-role="install-row">
          <div class="row-head">
            <span class="row-name">{{ s.label }}</span>
            <span class="row-phase" :data-phase="s.phase">{{ phaseLabel(s.phase) }}</span>
          </div>

          <!-- plan 落位清单 -->
          <div v-if="s.plan" class="plan-block" data-role="plan-block">
            <div class="block-title">落位清单</div>
            <ul class="plan-list">
              <li v-for="(p, idx) in s.plan.placements" :key="idx" class="plan-item">
                <code class="plan-source">{{ p.source }}</code>
                <span class="arrow">→</span>
                <code class="plan-target">{{ p.target }}</code>
              </li>
            </ul>
          </div>

          <!-- 错误展示 -->
          <div v-if="s.error" class="error-block" data-role="error-block">
            <div class="error-msg">{{ s.error.message }}</div>
          </div>

          <!-- 完成态报告摘要 -->
          <div v-if="s.report && s.phase === 'success'" class="report-block" data-role="report-block">
            <div class="block-title">安装报告</div>
            <div class="report-row">result: <code>{{ s.report.result }}</code></div>
            <div class="report-row">base: <code>{{ s.report.base }}</code></div>
            <div class="report-row">drift: {{ s.drift && s.drift.length === 0 ? '无漂移' : (s.drift?.length ?? 0) + ' 项漂移' }}</div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button v-if="step === 1" type="button" class="btn btn-ghost" @click="close">取消</button>
        <button
          v-if="step === 1"
          type="button"
          class="btn btn-primary"
          :disabled="selectedBaseIds.size === 0"
          @click="goConfirm"
        >下一步</button>
        <button v-if="step === 2" type="button" class="btn btn-ghost" @click="back">上一步</button>
        <button
          v-if="step === 2"
          type="button"
          class="btn btn-primary"
          data-role="start-install"
          @click="startInstall"
        >开始安装</button>
        <button
          v-if="step === 3 && hasFailed"
          type="button"
          class="btn btn-primary"
          data-role="retry"
          @click="retry"
        >重试</button>
        <button v-if="step === 3" type="button" class="btn btn-ghost" @click="close">{{ allSuccess ? '完成' : '关闭' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--g200, #e5e7eb);
}

.modal-head h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--g500, #6b7280);
  padding: 4px;
  border-radius: 6px;
}

.close-btn:hover {
  background: var(--g100, #f3f4f6);
}

.modal-body {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
}

.modal-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid var(--g200, #e5e7eb);
}

.step-hint {
  font-size: 13px;
  color: var(--g600, #4b5563);
  margin-bottom: 14px;
}

.probe-row {
  margin-bottom: 14px;
  display: flex;
  justify-content: flex-end;
}

.empty-hint {
  text-align: center;
  padding: 36px 12px;
  font-size: 13px;
  color: var(--g500, #6b7280);
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.host-card {
  border: 1.5px solid var(--g200, #e5e7eb);
  border-radius: 10px;
  padding: 14px 10px;
  cursor: pointer;
  text-align: center;
  transition: 0.12s;
  background: #fff;
}

.host-card:hover {
  border-color: var(--blue-300, #93c5fd);
}

.host-card.on {
  border-color: var(--blue-600, #2563eb);
  background: var(--blue-50, #eff6ff);
  box-shadow: 0 0 0 2px var(--blue-100, #dbeafe);
}

.host-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: var(--g100, #f3f4f6);
}

.host-card.disabled:hover {
  border-color: var(--g200, #e5e7eb);
}

.host-icon {
  font-size: 22px;
  margin-bottom: 6px;
}

.host-name {
  font-weight: 600;
  font-size: 13px;
}

.host-id {
  font-family: Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--g500, #6b7280);
  margin-top: 2px;
}

.host-status {
  margin-top: 6px;
  font-size: 11px;
  color: var(--g500, #6b7280);
}

.host-version {
  margin-top: 6px;
  font-size: 11px;
  color: var(--blue-700, #1d4ed8);
  font-family: Menlo, Consolas, monospace;
}

.confirm-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.confirm-list li {
  padding: 10px 0;
  border-bottom: 1px solid var(--g100, #f3f4f6);
}

.confirm-list li:last-child {
  border-bottom: none;
}

.confirm-host-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.confirm-name {
  font-weight: 600;
  font-size: 13px;
  min-width: 110px;
}

.alias-input {
  flex: 1;
  border: 1px solid var(--g300, #d1d5db);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}

.alias-input:focus {
  border-color: var(--blue-500, #3b82f6);
  box-shadow: 0 0 0 3px var(--blue-100, #dbeafe);
}

.install-row {
  padding: 14px 0;
  border-bottom: 1px solid var(--g100, #f3f4f6);
}

.install-row:last-child {
  border-bottom: none;
}

.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.row-name {
  font-weight: 600;
  font-size: 13px;
}

.row-phase {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--g100, #f3f4f6);
  color: var(--g700, #374151);
}

.row-phase[data-phase='success'] {
  background: #dcfce7;
  color: #166534;
}

.row-phase[data-phase='failed'] {
  background: #fee2e2;
  color: #991b1b;
}

.block-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--g600, #4b5563);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 8px 0 6px;
}

.plan-block,
.report-block,
.error-block {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--g100, #f3f4f6);
}

.plan-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.plan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
}

.plan-source,
.plan-target {
  font-family: Menlo, Consolas, monospace;
  color: var(--g700, #374151);
}

.arrow {
  color: var(--g500, #6b7280);
}

.error-block {
  background: #fef2f2;
}

.error-msg {
  font-size: 12.5px;
  color: #991b1b;
  font-weight: 500;
}

.report-row {
  font-size: 12px;
  color: var(--g700, #374151);
  padding: 2px 0;
}

.report-row code {
  font-family: Menlo, Consolas, monospace;
  color: var(--blue-700, #1d4ed8);
}

/* btn 通用 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  font-weight: 500;
  font-family: inherit;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--blue-600, #2563eb);
  color: #fff;
}

.btn-primary:not(:disabled):hover {
  background: var(--blue-700, #1d4ed8);
}

.btn-ghost {
  background: #fff;
  border-color: var(--g300, #d1d5db);
  color: var(--g700, #374151);
}

.btn-ghost:hover {
  border-color: var(--blue-400, #60a5fa);
  color: var(--blue-700, #1d4ed8);
}
</style>
