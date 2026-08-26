import type { RouteRecordRaw } from 'vue-router'

import KanbanView from '../../views/KanbanView.vue'

/**
 * kanban 域路由（I0-5 T3 占位 → L5 看板线 2026-08-27 填充为真实页面）：
 * 任务看板 = KB-01（SSE 实时看板）+ KB-02（发起任务表单）落地页。
 * 数据全部事件驱动（kanban store），运行时接线见 composables/use-kanban-runtime.ts
 * （dev/fixture 演出 vs live 真实引擎）。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const kanbanRoutes: RouteRecordRaw[] = [
  {
    path: 'kanban',
    component: KanbanView,
  },
]
