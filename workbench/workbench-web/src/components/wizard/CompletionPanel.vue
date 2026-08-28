<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { saveAsTemplate } from '../../api/employees'
import { clearDraft } from '../../composables/useWizardDraft'
import { useWizardStore } from '../../stores/wizard'
import InstallModal from './InstallModal.vue'

/**
 * CompletionPanel（L1 员工新建线 Task 16）：
 * 生成员工包成功后的完成态视图：
 * - 包路径 + files 清单展示
 * - 三动作：
 *   ① 「安装到底座」→ 打开 InstallModal（静态三底座 + API 预留 + 待接入提示）
 *   ② 「保存为角色模板」→ saveAsTemplate → 成功 toast「已保存为角色模板」/ 失败 toast「保存模板服务未就绪」
 *   ③ 「完成离开」→ router.push('/employees') + clearDraft()
 *
 * 禁词红线：本组件是完成态显式「安装到底座」动作承载——「安装」字样在本组件允许出现；
 * 但不得出现「AgentHub」「digital-staff」等其他禁词。
 */

const props = defineProps<{
  /** 生成员工包的落盘路径 */
  packagePath: string
  /** 生成员工包的文件清单 */
  files: string[]
}>()

const store = useWizardStore()
const router = useRouter()

/** 安装弹层显隐 */
const installOpen = ref(false)

/** toast 文案 */
const toast = ref('')
const toastVisible = ref(false)

function showToast(text: string): void {
  toast.value = text
  toastVisible.value = true
  setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

/** ① 安装到底座 → 打开 InstallModal */
function onInstall(): void {
  installOpen.value = true
}

function onInstallClose(): void {
  installOpen.value = false
}

/** ② 保存为角色模板 */
async function onSaveAsTemplate(): Promise<void> {
  try {
    await saveAsTemplate(store.draft)
    showToast('已保存为角色模板')
  } catch {
    // service 端 POST /api/templates 尚未实现——404/失败归一到统一文案
    showToast('保存模板服务未就绪')
  }
}

/** ③ 完成离开 → router.push + clearDraft */
function onFinish(): void {
  clearDraft()
  void router.push('/employees')
}
</script>

<template>
  <div class="completion" data-role="completion">
    <div class="completion-head">
      <div class="done-icon">✅</div>
      <h3>员工包已生成</h3>
    </div>

    <!-- 包路径 -->
    <div class="path-block">
      <div class="path-label">包路径</div>
      <code class="path-value">{{ props.packagePath }}</code>
    </div>

    <!-- files 清单 -->
    <div class="files-block">
      <div class="files-label">文件清单（{{ props.files.length }} 项）</div>
      <ul class="files-list">
        <li v-for="(f, idx) in props.files" :key="idx" class="file-row">
          <span class="file-icon">📄</span>
          <code class="file-path">{{ f }}</code>
        </li>
      </ul>
    </div>

    <!-- 三动作 -->
    <div class="actions">
      <button type="button" class="btn btn-primary" data-role="action-install" @click="onInstall">
        安装到底座
      </button>
      <button type="button" class="btn btn-ghost" data-role="action-save-template" @click="onSaveAsTemplate">
        保存为角色模板
      </button>
      <button type="button" class="btn btn-ghost" data-role="action-finish" @click="onFinish">
        完成离开
      </button>
    </div>

    <!-- toast -->
    <div v-if="toastVisible" class="toast" data-role="toast">{{ toast }}</div>

    <!-- 安装弹层 -->
    <InstallModal
      v-if="installOpen"
      :employee-id="store.draft.id"
      @close="onInstallClose"
    />
  </div>
</template>

<style scoped>
.completion {
  background: #fff;
  border: 1px solid var(--g200, #e5e7eb);
  border-radius: 14px;
  padding: 22px;
}

.completion-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.done-icon {
  font-size: 22px;
}

.completion-head h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.path-block,
.files-block {
  margin-bottom: 16px;
}

.path-label,
.files-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--g600, #4b5563);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.path-value {
  display: block;
  background: var(--g100, #f3f4f6);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-family: Menlo, Consolas, monospace;
  color: var(--g700, #374151);
  word-break: break-all;
}

.files-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid var(--g200, #e5e7eb);
  border-radius: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--g100, #f3f4f6);
  font-size: 12.5px;
}

.file-row:last-child {
  border-bottom: none;
}

.file-icon {
  font-size: 14px;
}

.file-path {
  font-family: Menlo, Consolas, monospace;
  color: var(--g700, #374151);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 9px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  font-weight: 500;
  font-family: inherit;
  transition: 0.15s;
}

.btn-primary {
  background: var(--blue-600, #2563eb);
  color: #fff;
}

.btn-primary:hover {
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

/* toast */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--g800, #1f2937);
  color: #fff;
  padding: 10px 18px;
  border-radius: 9px;
  font-size: 13px;
  z-index: 1100;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}
</style>
