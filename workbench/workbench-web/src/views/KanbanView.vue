<script setup lang="ts">
/**
 * 任务看板页壳（L5 看板线 T8，KB-01）：page-head + SSE 连接态 + 空态/任务卡列表 +
 * 发起任务入口（KB-02 弹窗 T10 接入）。数据全部来自 kanban store（事件归并产物），
 * 运行时接线（SSE 连接生命周期/fixture 演出）在 T9 use-kanban-runtime 挂载。
 */
import { computed } from 'vue'
import ConnectionBar from '../components/kanban/ConnectionBar.vue'
import TaskBoardCard from '../components/kanban/TaskBoardCard.vue'
import { useKanbanStore } from '../stores/kanban'

const store = useKanbanStore()

const tasks = computed(() => store.taskList)
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
        <button class="btn primary">发起任务</button>
      </div>
    </header>

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
