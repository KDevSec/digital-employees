<script setup lang="ts">
/**
 * 泳道任务全景页（T4，1.0 协同编排页形态·抄形不抄管线）：
 * 五列泳道（需求池→待办池→协同执行→待人工决策→已交付）——需求池本地草稿，
 * 后四列 = 引擎任务 laneOf 派生；仅需求池→待办池可拖（=发起编排 createTask，
 * 派单失败留池可重拖）；点卡进 /kanban 任务详情（双层衔接）。
 * 数据通道 = 2.0 契约：SSE 事件推送（D-056 复合 id）+ hydrate 事件重放（非 1.0
 * tick+2s 全量重拉）；api 可注入（测试替身，默认 httpEngineApi——D-053 纯真实接线）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { httpEngineApi, type EngineApi, type FlowSummary } from '../api/engine-api'
import { createEngineStream, streamUrl, type EngineStream } from '../api/engine-stream'
import BoardLane from '../components/board/BoardLane.vue'
import BoardCard from '../components/board/BoardCard.vue'
import NeedDrawer from '../components/board/NeedDrawer.vue'
import ConnectionBar from '../components/kanban/ConnectionBar.vue'
import { useKanbanStore } from '../stores/kanban'
import { LANES, laneOf, useBoardStore, type LaneId, type NeedDraft } from '../stores/board'

const props = withDefaults(defineProps<{ api?: EngineApi }>(), { api: () => httpEngineApi })
const api = computed(() => props.api)

const store = useKanbanStore()
const board = useBoardStore()
const router = useRouter()

/* ---------- SSE 真实订阅 + 初值拉取（与 KanbanView 同款接线，D-061） ---------- */
let stream: EngineStream | null = null

onMounted(async () => {
  try {
    stream = createEngineStream(streamUrl())
    store.connect(stream)
  } catch {
    store.connection = 'closed'
  }
  void store.hydrate(api.value)
  try {
    flows.value = await api.value.getFlows()
  } catch {
    /* 引擎未通：流程下拉空（抽屉校验兜底） */
  }
})

onUnmounted(() => {
  store.disconnect(stream)
  stream = null
})

/* ---------- 分列派生 ---------- */
const tasksByLane = computed<Record<LaneId, typeof store.taskList>>(() => {
  const out: Record<LaneId, typeof store.taskList> = { pool: [], plan: [], exec: [], decide: [], done: [] }
  for (const t of store.taskList) out[laneOf(t)].push(t)
  return out
})

function cardsOf(lane: LaneId): unknown[] {
  return lane === 'pool' ? board.needs : tasksByLane.value[lane]
}

/* ---------- 需求池草稿（本地态；error = 上次派单失败留池重拖） ---------- */
const drawerOpen = ref(false)
const flows = ref<FlowSummary[]>([])
const defaultWorkspace = computed(() => store.taskList[0]?.workspace ?? '')

const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3000)
}

function onAddNeed(need: Omit<NeedDraft, 'id'>): void {
  board.addNeed(need)
  showToast('已加入需求池——拖到待办池发起编排')
}

/** 拖入待办池 = 发起编排（createTask）；失败留池记错误（重拖重试，1.0 语义） */
async function dispatchNeed(needId: string): Promise<void> {
  const need = board.needs.find((n) => n.id === needId)
  if (!need) return
  try {
    const { task_id } = await api.value.createTask({
      mode: 'team',
      flow: need.flow,
      workspace: need.workspace,
      title: need.title,
      input: need.input,
      base: need.base,
    })
    board.removeNeed(needId)
    store.seedTask(task_id, { title: need.title })
    showToast('已发起编排')
  } catch (err) {
    board.markNeedError(needId, err instanceof Error ? err.message : String(err))
  }
}

function onNeedDragStart(e: DragEvent, needId: string): void {
  e.dataTransfer?.setData('text/plain', needId)
}

/* ---------- 决策辅按钮（D-kb05：对话式为主通道） ---------- */
async function onApprove(taskId: string): Promise<void> {
  const task = store.tasks[taskId]
  try {
    await api.value.confirmGate(taskId, task?.currentNode ?? '', 'approve')
  } catch {
    /* 放行失败停靠卡仍在场可重试 */
  }
}

async function onReject(taskId: string, note: string): Promise<void> {
  const task = store.tasks[taskId]
  try {
    await api.value.confirmGate(taskId, task?.currentNode ?? '', 'reject', note)
  } catch {
    /* 同上 */
  }
}

/* ---------- 双层衔接：点卡进任务详情 ---------- */
async function openTask(taskId: string): Promise<void> {
  await router.push({ path: '/kanban', query: { task: taskId } })
}

// 暴露给测试（drop/点卡的程序化触发路径）与模板
defineExpose({ dispatchNeed, openTask })
</script>

<template>
  <section class="board-page">
    <header class="board-head">
      <div>
        <h1>协同编排</h1>
        <p class="sub">创建需求 → 拖入待办池发起编排 → 员工协同执行 → 闸位停靠人工决策 → 交付</p>
      </div>
      <div class="head-actions">
        <ConnectionBar :connection="store.connection" />
        <RouterLink class="btn ghost" to="/kanban">任务详情</RouterLink>
        <button class="btn primary" @click="drawerOpen = true">＋ 创建需求</button>
      </div>
    </header>

    <p class="stats">任务 {{ store.taskList.length }} · 需求 {{ board.needs.length }}<span v-if="toast" class="toast">{{ toast }}</span></p>

    <div class="board-lanes">
      <BoardLane
        v-for="lane in LANES"
        :key="lane.id"
        :lane="lane"
        :cards="cardsOf(lane.id)"
        @drop-need="dispatchNeed"
      >
        <!-- 需求池：本地草稿卡（可拖；失败红块常驻） -->
        <template v-if="lane.id === 'pool'">
          <div
            v-for="need in board.needs"
            :key="need.id"
            class="need-card"
            draggable="true"
            @dragstart="(e) => onNeedDragStart(e, need.id)"
          >
            <div class="ck-title">{{ need.title }}</div>
            <div class="ck-tags">
              <span class="tag tag-gray">需求</span>
              <span class="tag tag-gray">{{ need.flow ?? '?' }}</span>
            </div>
            <div v-if="need.error" class="ck-block">派单失败：{{ need.error }}（重拖到待办池重试）</div>
            <p class="need-hint">拖到「待办池」发起编排</p>
          </div>
        </template>

        <!-- 引擎任务卡（派生列，点卡进详情） -->
        <template v-else>
          <BoardCard
            v-for="task in tasksByLane[lane.id]"
            :key="task.taskId"
            :task="task"
            :table="store.tables[task.taskId] ?? null"
            :lane="lane.id"
            :employees="store.employeesMap"
            @open="openTask"
            @approve="onApprove"
            @reject="onReject"
          />
        </template>
      </BoardLane>
    </div>

    <NeedDrawer v-model:open="drawerOpen" :flows="flows" :default-workspace="defaultWorkspace" @add="onAddNeed" />
  </section>
</template>

<style scoped>
.board-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.sub {
  margin: 4px 0 0;
  color: var(--g500);
  font-size: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
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
  text-decoration: none;
}

.btn.primary { background: var(--blue-600); color: #fff; }
.btn.ghost { background: #fff; border-color: var(--g200); color: var(--g600); }

.stats {
  margin: 0;
  color: var(--g500);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.toast {
  background: var(--green-bg, #dcfce7);
  color: var(--green, #16a34a);
  border-radius: 99px;
  padding: 3px 12px;
  font-size: 11.5px;
}

.board-lanes {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  align-items: stretch;
  min-height: calc(100vh - 220px);
  padding-bottom: 4px;
}

/* 需求草稿卡（可拖——池内唯一可拖元素） */
.need-card {
  border: 1px solid var(--g200);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 7px;
  cursor: grab;
}

.need-card:active {
  cursor: grabbing;
}

.ck-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g800);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ck-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 500;
}

.tag-gray { background: var(--g100); color: var(--g500); }

.ck-block {
  background: var(--red-bg, #fee2e2);
  color: var(--red, #dc2626);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11.5px;
  line-height: 1.6;
}

.need-hint {
  margin: 0;
  color: var(--g400);
  font-size: 11px;
}
</style>
