<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * InstallModal（L1 员工新建线 Task 16）：
 * 沿 demo 三步形态：
 * ① 底座选择——静态数组 `[{id:'claude-code',display:'Claude Code'},{id:'codebuddy',display:'CodeBuddy'},{id:'qoder',display:'Qoder'}]` 卡片多选
 * ② 确认页——所选底座清单 + 别名 input 可选
 * ③「开始安装」按钮 → POST /api/installs body {employee_id, hosts, alias}
 *   预留路径：任何失败/404 catch → 第③步区域显示「安装服务待接入（安装线联调后开放）」提示态
 *   （不抛错、不模拟进度、不 retry）
 *
 * 禁词红线：本组件是完成态显式「安装到底座」动作承载——「安装」字样在本组件允许出现；
 * 但不得出现「AgentHub」「digital-staff」等其他禁词。
 */

const props = defineProps<{
  /** 员工 ID（生成成功后传入） */
  employeeId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 静态底座清单 */
interface HostOption {
  id: string
  display: string
}

const HOSTS: HostOption[] = [
  { id: 'claude-code', display: 'Claude Code' },
  { id: 'codebuddy', display: 'CodeBuddy' },
  { id: 'qoder', display: 'Qoder' },
]

/** 当前步骤（1 选择 / 2 确认 / 3 安装中或失败提示） */
const step = ref<1 | 2 | 3>(1)

/** 已选底座 id 集合 */
const selectedHostIds = ref<Set<string>>(new Set())

/** 别名（按 host id 索引，可选） */
const aliases = ref<Record<string, string>>({})

/** 安装失败提示态——任何 catch 进此态 */
const installPending = ref(false)
const installFailed = ref(false)

/** 已选底座对象清单（确认页渲染） */
const selectedHosts = computed(() => HOSTS.filter((h) => selectedHostIds.value.has(h.id)))

/** 切换底座勾选 */
function toggleHost(id: string): void {
  const next = new Set(selectedHostIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedHostIds.value = next
}

/** 下一步：选择 → 确认（至少选一个） */
function goConfirm(): void {
  if (selectedHostIds.value.size === 0) return
  step.value = 2
}

/** 返回上一步 */
function back(): void {
  if (step.value === 2) step.value = 1
}

/** 开始安装——POST /api/installs；任何失败/404 catch → 提示态 */
async function startInstall(): Promise<void> {
  installPending.value = true
  step.value = 3
  try {
    const res = await fetch('/api/installs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: props.employeeId,
        hosts: Array.from(selectedHostIds.value),
        alias: aliases.value,
      }),
    })
    if (!res.ok) {
      installFailed.value = true
      return
    }
    // 成功——预留态：暂不处理（service 端 /api/installs 待接入）；按当前契约总是失败路径
    installFailed.value = true
  } catch {
    installFailed.value = true
  } finally {
    installPending.value = false
  }
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
        <div class="step-hint">选择目标底座（可多选）</div>
        <div class="host-grid">
          <div
            v-for="h in HOSTS"
            :key="h.id"
            class="host-card"
            :class="{ on: selectedHostIds.has(h.id) }"
            data-host
            @click="toggleHost(h.id)"
          >
            <div class="host-icon">📦</div>
            <div class="host-name">{{ h.display }}</div>
            <div class="host-id">{{ h.id }}</div>
          </div>
        </div>
      </div>

      <!-- ② 确认页 -->
      <div v-else-if="step === 2" class="modal-body">
        <div class="step-hint">确认安装到以下底座：</div>
        <ul class="confirm-list">
          <li v-for="h in selectedHosts" :key="h.id" data-role="confirm-host-item">
            <div class="confirm-host-row">
              <span class="confirm-name">{{ h.display }}</span>
              <input
                class="alias-input"
                type="text"
                :placeholder="`别名（可选，默认 ${employeeId}）`"
                :value="aliases[h.id] ?? ''"
                @input="aliases[h.id] = ($event.target as HTMLInputElement).value"
              />
            </div>
          </li>
        </ul>
      </div>

      <!-- ③ 安装中 / 失败提示态 -->
      <div v-else class="modal-body">
        <div v-if="installPending" class="step-hint">正在安装…</div>
        <div v-else-if="installFailed" class="install-failed" data-role="install-failed">
          <div class="failed-icon">ℹ️</div>
          <div class="failed-text">安装服务待接入（安装线联调后开放）</div>
          <div class="failed-sub">本员工包已落盘到 employees/ 目录，可后续手动接入。</div>
        </div>
      </div>

      <div class="modal-foot">
        <button v-if="step === 1" type="button" class="btn btn-ghost" @click="close">取消</button>
        <button
          v-if="step === 1"
          type="button"
          class="btn btn-primary"
          :disabled="selectedHostIds.size === 0"
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
        <button v-if="step === 3 && installFailed" type="button" class="btn btn-primary" @click="close">关闭</button>
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
  max-width: 520px;
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

.install-failed {
  text-align: center;
  padding: 24px 12px;
}

.failed-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.failed-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--g700, #374151);
  margin-bottom: 6px;
}

.failed-sub {
  font-size: 12px;
  color: var(--g500, #6b7280);
  line-height: 1.55;
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
