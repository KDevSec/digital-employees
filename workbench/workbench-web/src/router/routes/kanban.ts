import type { RouteRecordRaw } from 'vue-router'

import BoardView from '../../views/BoardView.vue'
import KanbanView from '../../views/KanbanView.vue'

/**
 * kanban 域路由（I0-5 T3 占位 → L5 看板线 2026-08-27 填充为真实页面）：
 * 任务看板 = KB-01（SSE 实时看板）+ KB-02（发起任务表单）落地页。
 * T4（L5×L3 联调）补泳道全景层：/kanban/board = 五列泳道任务列表（1.0 协同编排
 * 形态——需求池拖拽发起），点卡进 /kanban?task=<id> 任务详情——两层互补（全景/单任务推进）。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const kanbanRoutes: RouteRecordRaw[] = [
  {
    path: 'kanban/board',
    component: BoardView,
  },
  {
    path: 'kanban',
    component: KanbanView,
  },
]
