<script setup lang="ts">
/**
 * 创建需求抽屉（T4，1.0 右侧抽屉 40% 宽 transform 动画形态）：需求池的入口——
 * 只建草稿不发起（发起 = 拖入待办池）。字段 = CreateTaskModal 子集（mode/流程/
 * 工作区/标题/需求文本/底座），提交 emit add。按钮文案精简（品牌 §4）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { FlowSummary } from '../../api/engine-api'
import { fetchBases, type BaseCard } from '../../api/bases'
import type { NeedDraft } from '../../stores/board'

const props = defineProps<{
  open: boolean
  flows: FlowSummary[]
  defaultWorkspace: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  add: [need: Omit<NeedDraft, 'id'>]
}>()

const form = reactive({ title: '', input: '', flow: '', workspace: '', base: '' })
const formError = ref<string | null>(null)

/** 底座真实源（D-062，与 CreateTaskModal 同口径：GET /api/bases；空 = 仅「未选择」占位项） */
const baseCards = ref<BaseCard[]>([])
onMounted(async () => {
  baseCards.value = await fetchBases()
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      form.title = ''
      form.input = ''
      form.flow = props.flows[0]?.flow ?? ''
      form.workspace = props.defaultWorkspace
      form.base = ''
      formError.value = null
    }
  },
  { immediate: true }, // mount 即 open=true 也要初始化表单（无变化不触发 watch 的坑）
)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.title.trim()) e.title = '请填写需求标题'
  if (!form.input.trim()) e.input = '请填写需求描述'
  if (!form.workspace.trim()) e.workspace = '请填写工作区路径'
  if (!form.flow) e.flow = '请选择流程'
  return e
})

function submit(): void {
  if (Object.keys(errors.value).length > 0) return
  emit('add', {
    title: form.title.trim(),
    input: form.input.trim(),
    workspace: form.workspace.trim(),
    flow: form.flow,
    base: form.base || undefined,
  })
  emit('update:open', false)
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="mask show" @click.self="close"></div>
  <aside v-if="open" class="drawer show">
    <header class="d-head">
      <b>创建需求</b>
      <button class="d-close" type="button" @click="close">×</button>
    </header>
    <form class="d-body" @submit.prevent="submit">
      <div class="field">
        <label>需求标题</label>
        <input v-model="form.title" data-f="title" placeholder="如：支付网关对接" />
        <p v-if="errors.title" class="err">{{ errors.title }}</p>
      </div>
      <div class="field">
        <label>流程</label>
        <select v-model="form.flow">
          <option v-for="f in flows" :key="f.flow" :value="f.flow">{{ f.display_name ?? f.flow }}</option>
        </select>
        <p v-if="errors.flow" class="err">{{ errors.flow }}</p>
      </div>
      <div class="field">
        <label>工作区</label>
        <input v-model="form.workspace" data-f="workspace" placeholder="如 D:/demo/r-x" />
        <p v-if="errors.workspace" class="err">{{ errors.workspace }}</p>
      </div>
      <div class="field">
        <label>底座</label>
        <select v-model="form.base" data-f="base">
          <option value="">未选择</option>
          <option
            v-for="b in baseCards"
            :key="b.id"
            :value="b.id"
            :disabled="!b.present"
          >{{ b.present ? `${b.label}（${b.version ?? '未知版本'}）` : `${b.label}（未检测到）` }}</option>
        </select>
      </div>
      <div class="field">
        <label>需求描述</label>
        <textarea v-model="form.input" data-f="input" rows="5" placeholder="任务要解决的需求描述（将注入节点指令 {{input}}）"></textarea>
        <p v-if="errors.input" class="err">{{ errors.input }}</p>
      </div>
      <p v-if="formError" class="err">{{ formError }}</p>
      <button class="nd-submit btn-primary" type="submit" :disabled="Object.keys(errors).length > 0">加入需求池</button>
    </form>
  </aside>
</template>
<!-- 抽屉为 position:fixed 全屏浮层，不经 Teleport（VTU wrapper 可见性 + fixed 本无需传送） -->

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  z-index: 60;
}

.mask.show {
  opacity: 1;
  pointer-events: auto;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 40%;
  min-width: 360px;
  background: #fff;
  border-left: 1px solid var(--g200);
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.08);
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 61;
  display: flex;
  flex-direction: column;
}

.drawer.show {
  transform: translateX(0);
}

.d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--g100);
  font-size: 14px;
}

.d-close {
  border: none;
  background: none;
  font-size: 18px;
  color: var(--g400);
  cursor: pointer;
}

.d-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field label {
  font-size: 12px;
  color: var(--g600);
  font-weight: 500;
}

.field input,
.field select,
.field textarea {
  border: 1px solid var(--g200);
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--blue-600);
}

.err {
  color: var(--red, #dc2626);
  font-size: 11.5px;
  margin: 0;
}

.btn-primary {
  margin-top: auto;
  background: var(--blue-600);
  color: #fff;
  border: none;
  border-radius: 9px;
  padding: 10px 16px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
