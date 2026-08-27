<script setup lang="ts">
/**
 * 发起任务表单（L5 看板线 T10，KB-02；字段面 = 协同编排设计 §2 裁决 11 / §9.4）：
 * mode（团队选表 / 单员工动态建表——引擎生成单节点表，一切任务皆 flow）+ 底座（静态三选，
 * B-06 探测归 L2）+ 模型/努力档位（「使用流程阶段内置档位」勾选时任务级置空禁用，
 * 表 model_tier 优先——§9.4 四层解析链）+ 工作区 + 需求文本。
 * 提交 → api.createTask（载荷 1:1 §9.1 参数）→ emit created(task_id) + 关闭；
 * 失败错误常驻表单区（纪律⑥非 toast）。按钮文案精简（品牌 §4）。
 */
import { computed, reactive, ref, watch } from 'vue'
import type { CreateTaskPayload, EngineApi, FlowSummary } from '../../api/engine-api'
import { createTaskPayload } from '../../api/engine-api'

const props = defineProps<{
  open: boolean
  flows: FlowSummary[]
  employees: Record<string, string>
  /** 引擎 API（runtime 未就绪时可为 null——表单只读不可提交） */
  api: EngineApi | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  created: [taskId: string]
}>()

const BASES = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codebuddy', label: 'CodeBuddy' },
  { value: 'qoder', label: 'Qoder' },
]

/** 档位组（1.0 五档语义，Q7 口径；真实数据源 listModels 归 L2——契约歧义 E） */
const TIERS = ['', '评审安全档', '设计档', '探索档', '编码档', '执行档']
const EFFORTS = ['', 'low', 'medium', 'high']

const form = reactive({
  mode: 'team' as 'team' | 'solo',
  flow: '',
  employee: '',
  title: '',
  base: '',
  model: '',
  effort: '',
  useFlowTier: false,
  workspace: '',
  input: '',
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      form.flow = props.flows[0]?.flow ?? ''
      form.employee = Object.keys(props.employees)[0] ?? ''
    }
  },
  { immediate: true },
)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.title.trim()) e.title = '请填写任务标题'
  if (!form.workspace.trim()) e.workspace = '请填写工作区路径'
  if (!form.input.trim()) e.input = '请填写需求文本'
  if (form.mode === 'team' && !form.flow) e.flow = '请选择流程'
  if (form.mode === 'solo' && !form.employee) e.employee = '请选择员工'
  return e
})

const submitting = ref(false)
const formError = ref<string | null>(null)

async function submit(): Promise<void> {
  if (Object.keys(errors.value).length > 0 || submitting.value || !props.api) return
  submitting.value = true
  formError.value = null
  const payload = createTaskPayload({
    mode: form.mode,
    flow: form.mode === 'team' ? form.flow : undefined,
    employee: form.mode === 'solo' ? form.employee : undefined,
    title: form.title.trim(),
    workspace: form.workspace.trim(),
    input: form.input.trim(),
    base: form.base || undefined,
    // 内置档位勾选：任务级置空（表 model_tier 优先生效——载荷省略字段）
    model: form.useFlowTier ? '' : form.model,
    effort: form.useFlowTier ? '' : form.effort,
  } as CreateTaskPayload)
  try {
    const { task_id } = await props.api.createTask(payload)
    emit('created', task_id)
    emit('update:open', false)
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="modal-mask show" @click.self="close">
    <form class="modal" @submit.prevent="submit">
      <div class="modal-head">
        <b>发起任务</b>
        <button type="button" class="modal-close" @click="close">×</button>
      </div>

        <div class="modal-body">
          <div class="field">
            <label>协作模式</label>
            <div class="mode-picker">
              <label class="mode-opt">
                <input v-model="form.mode" type="radio" value="team" data-field="mode" />
                团队协作
              </label>
              <label class="mode-opt">
                <input v-model="form.mode" type="radio" value="solo" data-field="mode" />
                单员工
              </label>
            </div>
          </div>

          <div v-if="form.mode === 'team'" class="field">
            <label>流程</label>
            <select v-model="form.flow" data-field="flow">
              <option v-for="f in flows" :key="f.flow" :value="f.flow">{{ f.display_name }}</option>
            </select>
            <p v-if="errors.flow" class="field-error">{{ errors.flow }}</p>
          </div>

          <div v-else class="field">
            <label>员工</label>
            <select v-model="form.employee" data-field="employee">
              <option v-for="(name, id) in employees" :key="id" :value="id">{{ name }}</option>
            </select>
            <p v-if="errors.employee" class="field-error">{{ errors.employee }}</p>
          </div>

          <div class="field">
            <label>任务标题</label>
            <input v-model="form.title" data-field="title" placeholder="如：支付网关对接联调" />
            <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
          </div>

          <div class="field">
            <label>底座</label>
            <select v-model="form.base" data-field="base">
              <option value="">跟随终端默认</option>
              <option v-for="b in BASES" :key="b.value" :value="b.value">{{ b.label }}</option>
            </select>
          </div>

          <div class="field-row">
            <div class="field">
              <label>模型档位</label>
              <select v-model="form.model" data-field="model" :disabled="form.useFlowTier">
                <option value="">跟随底座默认</option>
                <option v-for="t in TIERS.slice(1)" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div class="field">
              <label>努力档位</label>
              <select v-model="form.effort" data-field="effort" :disabled="form.useFlowTier">
                <option value="">跟随底座默认</option>
                <option v-for="e2 in EFFORTS.slice(1)" :key="e2" :value="e2">{{ e2 }}</option>
              </select>
            </div>
          </div>

          <label class="tier-check">
            <input v-model="form.useFlowTier" type="checkbox" data-field="useFlowTier" />
            使用流程阶段内置档位（各阶段按表内置模型档位执行）
          </label>

          <div class="field">
            <label>工作区</label>
            <input v-model="form.workspace" data-field="workspace" placeholder="如 D:/demo/r-x" />
            <p v-if="errors.workspace" class="field-error">{{ errors.workspace }}</p>
          </div>

          <div class="field">
            <label>需求文本</label>
            <textarea v-model="form.input" data-field="input" rows="4" placeholder="任务要解决的需求描述（将注入节点指令 {{input}}）"></textarea>
            <p v-if="errors.input" class="field-error">{{ errors.input }}</p>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>

        <div class="modal-foot">
          <button type="button" class="btn cancel" @click="close">取消</button>
          <button type="submit" class="btn primary submit" :disabled="Object.keys(errors).length > 0 || submitting">提交</button>
        </div>
    </form>
  </div>
</template>

<style scoped>
/* 原型 modal-mask/modal 语言 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  background: #fff;
  border-radius: 16px;
  width: 620px;
  max-width: 92vw;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

.modal-head {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--g100);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
}

.modal-close {
  border: none;
  background: var(--g100);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--g600);
  font-size: 13px;
}

.modal-close:hover {
  background: var(--g200);
}

.modal-body {
  padding: 14px 22px;
  overflow: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 13px;
  min-width: 0;
}

.field > label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--g600);
}

.field input,
.field select,
.field textarea {
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  color: var(--ink);
  background: #fff;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--blue-400);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.field textarea {
  resize: vertical;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mode-picker {
  display: flex;
  gap: 10px;
}

.mode-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  color: var(--g700);
}

.mode-opt:has(input:checked) {
  border-color: var(--blue-600);
  background: var(--blue-50);
  color: var(--blue-800);
}

.tier-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--g600);
  margin: -4px 0 13px;
  cursor: pointer;
}

.field-error {
  font-size: 11.5px;
  color: var(--red);
}

.form-error {
  background: var(--red-bg);
  border: 1px solid #fecaca;
  border-radius: 9px;
  padding: 9px 12px;
  font-size: 12.5px;
  color: var(--red);
  margin-bottom: 6px;
}

.modal-foot {
  padding: 12px 22px 16px;
  border-top: 1px solid var(--g100);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  border-radius: 9px;
  padding: 8px 18px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  font-weight: 500;
}

.btn.primary {
  background: var(--blue-600);
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  background: var(--blue-700);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.cancel {
  background: #fff;
  border-color: var(--g300);
  color: var(--g700);
}
</style>
