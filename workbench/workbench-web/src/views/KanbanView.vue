<script setup lang="ts">
/**
 * 任务看板页壳（L5 v0.2，KB-01；UI 对齐 1.0 demo 任务看板——design §13.2）：
 * 左列工作区任务树 + 右侧单任务详情（topbar / empband / stageband 阶段横幅 /
 * 黑底事件观战 / 告警 / 评审流水）。数据全部来自 kanban store（事件归并产物）。
 * 纯真实接线（design §13.3）：原生 EventSource + httpEngineApi，无 fixture 分支；
 * 引擎未通时诚实显示连接态与空态。测试经 vi.stubGlobal 注入替身。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { httpEngineApi, type FlowSummary } from '../api/engine-api'
import { createEngineStream, streamUrl, type EngineStream } from '../api/engine-stream'
import AlertPanel from '../components/kanban/AlertPanel.vue'
import ConnectionBar from '../components/kanban/ConnectionBar.vue'
import CreateTaskModal from '../components/kanban/CreateTaskModal.vue'
import EmpBand from '../components/kanban/EmpBand.vue'
import EventWatchPanel from '../components/kanban/EventWatchPanel.vue'
import GateFeedPanel from '../components/kanban/GateFeedPanel.vue'
import StageBand from '../components/kanban/StageBand.vue'
import TaskSidebar from '../components/kanban/TaskSidebar.vue'
import { useKanbanStore, type TaskStatus } from '../stores/kanban'

const store = useKanbanStore()

const tasks = computed(() => store.taskList)

/* ---------- SSE 真实订阅（页面卸载即断） ---------- */
let stream: EngineStream | null = null

onMounted(() => {
  // EventSource 缺失（老浏览器/受限环境）优雅降级：连接态保持已断开，页面其余功能不炸
  try {
    stream = createEngineStream(streamUrl())
    store.connect(stream)
  } catch {
    store.connection = 'closed'
  }
})

onUnmounted(() => {
  store.disconnect(stream)
  stream = null
})

/* ---------- 选中任务与派生数据 ---------- */
const selectedId = ref<string | null>(null)

// 任务列表变化：默认选中第一个；缺表的任务拉表快照（契约歧义 A 口径）
watch(
  () => tasks.value.map((t) => t.taskId),
  async (ids) => {
    if (ids.length > 0 && (!selectedId.value || !ids.includes(selectedId.value))) {
      selectedId.value = ids[0]
    }
    for (const id of ids) {
      if (store.tables[id]) continue
      try {
        const detail = await httpEngineApi.getTask(id)
        store.setTable(id, detail.table, detail.employees)
      } catch {
        /* 表拉取失败保持骨架态——事件流仍在推进，下次任务列表变动重试 */
      }
    }
  },
  { immediate: true },
)

const selected = computed(() => tasks.value.find((t) => t.taskId === selectedId.value) ?? null)

/** 左列迷你进度分母（表未到的任务不显示） */
const nodeTotals = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const [id, table] of Object.entries(store.tables)) {
    out[id] = table.nodes.filter((n) => n.kind !== 'terminal').length
  }
  return out
})

const nodeNames = computed<Record<string, string>>(() => {
  const table = selected.value ? store.tables[selected.value.taskId] : null
  if (!table) return {}
  return Object.fromEntries(table.nodes.map((n) => [n.id, n.name]))
})

const selectedFeed = computed(() =>
  selected.value ? store.feed.filter((e) => e.task_id === selected.value.taskId) : [],
)

/* ---------- 发起任务（KB-02） ---------- */
const modalOpen = ref(false)
const flows = ref<FlowSummary[]>([])

onMounted(async () => {
  try {
    flows.value = await httpEngineApi.getFlows()
  } catch {
    /* 引擎未通/表清单拉取失败：表单流程下拉空（提交时校验兜底） */
  }
})

function onCreated(taskId: string): void {
  store.seedTask(taskId)
  selectedId.value = taskId
}

/* ---------- 人工闸辅按钮（D-kb05；对话式为主通道） ---------- */
async function onGateConfirm(taskId: string, node: string | null): Promise<void> {
  try {
    await httpEngineApi.confirmGate(taskId, node ?? '', 'approve')
  } catch {
    /* 放行失败停靠条仍在场可重试 */
  }
}

async function onGateReject(taskId: string, node: string | null): Promise<void> {
  try {
    await httpEngineApi.confirmGate(taskId, node ?? '', 'reject')
  } catch {
    /* 同上 */
  }
}

/* ---------- 状态 tag ---------- */
const STATUS_META: Record<TaskStatus, { text: string; cls: string }> = {
  in_progress: { text: '进行中', cls: 'in-progress' },
  gate_paused: { text: '闸位停靠', cls: 'gate-paused' },
  blocked: { text: '阻塞', cls: 'blocked' },
  completed: { text: '已完成', cls: 'completed' },
  aborted: { text: '已终止', cls: 'aborted' },
}
</script>

<template>
  <section class="kanban-shell">
    <TaskSidebar :tasks="tasks" :selected-id="selectedId" :node-totals="nodeTotals" @select="selectedId = $event" />

    <div class="detail">
      <header class="topbar">
        <div class="tb-title">
          <template v-if="selected">
            <h1>{{ selected.title }}</h1>
            <span class="status-tag" :class="STATUS_META[selected.status].cls">{{ STATUS_META[selected.status].text }}</span>
            <span class="tb-flow">{{ selected.displayName || selected.flow }}</span>
            <span class="tb-ws mono">{{ selected.workspace }}</span>
          </template>
          <h1 v-else>任务看板</h1>
        </div>
        <div class="tb-actions">
          <ConnectionBar :connection="store.connection" />
          <button class="btn primary" @click="modalOpen = true">发起任务</button>
        </div>
      </header>

      <template v-if="selected">
        <div class="detail-scroll">
          <EmpBand :dispatches="selected.activeDispatches" :employees="store.employeesMap" :node-names="nodeNames" />

          <div class="card">
            <div class="card-h">🧭 任务阶段</div>
            <div class="card-b">
              <StageBand :table="store.tables[selected.taskId] ?? null" :task="selected" />
            </div>
          </div>

          <div class="card">
            <div class="card-h">⚡ 事件观战 <span class="tag">六类事件 · 实时</span></div>
            <div class="card-b">
              <EventWatchPanel :feed="selectedFeed" :employees="store.employeesMap" />
            </div>
          </div>

          <AlertPanel :task="selected" @confirm="(t) => onGateConfirm(t.taskId, t.currentNode)" @reject="(t) => onGateReject(t.taskId, t.currentNode)" />

          <div class="card">
            <div class="card-h">🔍 评审流水 <span class="tag">闸 · verdict · 轮次</span></div>
            <div class="card-b">
              <GateFeedPanel :records="selected.gateRecords" />
            </div>
          </div>
        </div>
      </template>

      <div v-else class="detail-empty">
        <div class="empty-inner">
          <p>暂无任务</p>
          <p class="empty-sub">点右上「发起任务」开一个 run，看板将实时呈现五阶段推进</p>
        </div>
      </div>
    </div>

    <CreateTaskModal
      v-model:open="modalOpen"
      :flows="flows"
      :employees="store.employeesMap"
      :api="httpEngineApi"
      @created="onCreated"
    />
  </section>
</template>

<style scoped>
/* 1.0 任务看板工作台布局：左树右详情，整页工作区式 */
.kanban-shell {
  display: grid;
  grid-template-columns: 330px 1fr;
  gap: 14px;
  height: calc(100vh - 108px);
  min-height: 480px;
}

.detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* topbar：任务标题 + 状态 tag + 连接条 + 发起入口 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 12px;
  flex-wrap: wrap;
}

.tb-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}

h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 340px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.status-tag.in-progress {
  background: var(--blue-100);
  color: var(--blue-800);
}

.status-tag.gate-paused {
  background: var(--amber-bg);
  color: var(--amber);
}

.status-tag.blocked,
.status-tag.aborted {
  background: var(--red-bg);
  color: var(--red);
}

.status-tag.completed {
  background: var(--green-bg);
  color: var(--green);
}

.tb-flow {
  color: var(--g500);
  font-size: 12px;
}

.mono {
  font-family: Menlo, Consolas, monospace;
}

.tb-ws {
  color: var(--g400);
  font-size: 11px;
}

.tb-actions {
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

/* 详情滚动区 */
.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}

.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.card-h {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--g100);
  font-size: 13px;
  font-weight: 600;
  color: var(--g700);
}

.card-h .tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 99px;
  background: var(--g100);
  color: var(--g500);
  font-size: 10.5px;
  font-weight: 500;
}

.card-b {
  padding: 12px 16px;
}

/* 空态 */
.detail-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
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

@media (max-width: 1000px) {
  .kanban-shell {
    grid-template-columns: 240px 1fr;
  }
}
</style>
