<script setup lang="ts">
/**
 * 任务看板页壳（L5 看板线 T8/T9，KB-01）：page-head + SSE 连接态 + 空态/任务卡列表 +
 * 发起任务入口（KB-02 弹窗 T10 接入）。数据全部来自 kanban store（事件归并产物）；
 * 运行时经 use-kanban-runtime 挂载（dev 默认 fixture 演出 / ?live=1 真实引擎）——
 * onMounted 建 runtime + connect 流；任务卡缺表时经 getTask 拉表快照（契约歧义 A 口径）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FlowSummary } from '../api/engine-api'
import ConnectionBar from '../components/kanban/ConnectionBar.vue'
import CreateTaskModal from '../components/kanban/CreateTaskModal.vue'
import FixtureControls from '../components/kanban/FixtureControls.vue'
import TaskBoardCard from '../components/kanban/TaskBoardCard.vue'
import { createKanbanRuntime, type KanbanRuntime } from '../composables/use-kanban-runtime'
import { useKanbanStore } from '../stores/kanban'

const store = useKanbanStore()

const tasks = computed(() => store.taskList)
const runtime = ref<KanbanRuntime | null>(null)
/** fixture 控制面（仅 fixture runtime 有；live 模式为 null → 控件不渲染） */
const fixtureControls = ref<import('../fixtures/kanban-fixture-service').FixtureControls | null>(null)

/** 发起任务弹窗（KB-02）：flows 经 getFlows 拉取；员工选择器映射（fixture 内置/L4 待接口） */
const modalOpen = ref(false)
const flows = ref<FlowSummary[]>([])
const pickerEmployees = ref<Record<string, string>>({})

onMounted(async () => {
  const rt = await createKanbanRuntime()
  runtime.value = rt
  if (rt && 'controls' in rt) fixtureControls.value = rt.controls
  if (rt && 'employees' in rt) pickerEmployees.value = (rt as { employees: Record<string, string> }).employees
  store.connect(rt?.openStream() ?? dummyStream())
  try {
    flows.value = await rt.api.getFlows()
  } catch {
    /* 表清单拉取失败：表单流程下拉空（提交时校验兜底） */
  }
})

onUnmounted(() => {
  store.disconnect()
  runtime.value?.cleanup()
})

/** runtime 为 null（测试/异常）时的空流占位——connect 拿到 close 能力即可 */
function dummyStream() {
  return { onEvent: () => {}, onConnectionChange: () => {}, close: () => {} }
}

/** 发起成功：占位卡先出（run.created 到达补全）；fixture 模式剧本已自动起播 */
function onCreated(taskId: string): void {
  store.seedTask(taskId)
}

/** 人工闸辅按钮（对话式为主通道）：confirmGate → 引擎放行（fixture 演出即恢复推流） */
async function onGateConfirm(taskId: string, node: string | null): Promise<void> {
  try {
    await runtime.value?.api.confirmGate(taskId, node ?? '', 'approve')
  } catch {
    /* 放行失败静默（停靠条仍在场重试——错误不吞语义由停靠态本身承担） */
  }
}

async function onGateReject(taskId: string, node: string | null): Promise<void> {
  try {
    await runtime.value?.api.confirmGate(taskId, node ?? '', 'reject')
  } catch {
    /* 同上 */
  }
}

// 任务卡缺表 → getTask 拉表快照 + 员工映射（getTask 下发口径）
watch(
  () => tasks.value.map((t) => t.taskId),
  async (ids) => {
    const api = runtime.value?.api
    if (!api) return
    for (const id of ids) {
      if (store.tables[id]) continue
      try {
        const detail = await api.getTask(id)
        store.setTable(id, detail.table, detail.employees)
      } catch {
        /* 表拉取失败保持骨架态——事件流仍在推进，下次任务列表变动重试 */
      }
    }
  },
)
</script>

<template>
  <section class="kanban-page">
    <header class="page-head">
      <div>
        <h1>任务看板</h1>
        <p class="sub">五阶段协同推进、闸位停靠与评审流水——事件实时驱动</p>
      </div>
      <div class="head-actions">
        <ConnectionBar :connection="store.connection" />
        <button class="btn primary" @click="modalOpen = true">发起任务</button>
      </div>
    </header>

    <FixtureControls v-if="fixtureControls" :controls="fixtureControls" />

    <CreateTaskModal
      v-model:open="modalOpen"
      :flows="flows"
      :employees="Object.keys(store.employeesMap).length > 0 ? store.employeesMap : pickerEmployees"
      :api="runtime?.api ?? null"
      @created="onCreated"
    />

    <div v-if="tasks.length === 0" class="empty card">
      <div class="empty-inner">
        <p>暂无任务</p>
        <p class="empty-sub">点右上「发起任务」开一个 run，看板将实时呈现五阶段推进</p>
      </div>
    </div>

    <TaskBoardCard
      v-for="task in tasks"
      :key="task.taskId"
      :task="task"
      :table="store.tables[task.taskId] ?? null"
      :employees="store.employeesMap"
      :feed="store.feed.filter((e) => e.task_id === task.taskId)"
      @confirm="(t) => onGateConfirm(t.taskId, t.currentNode)"
      @reject="(t) => onGateReject(t.taskId, t.currentNode)"
    />
  </section>
</template>

<style scoped>
/* 原型 .page-head/.card 语言（与 Placeholder.vue 同源） */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  font-weight: 500;
}

.btn.primary {
  background: var(--blue-600);
  color: #fff;
}

.btn.primary:hover {
  background: var(--blue-700);
}

.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  text-align: center;
}

.empty-inner p {
  color: var(--g500);
  font-size: 14px;
}

.empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--g400);
}
</style>
