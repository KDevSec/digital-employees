import type { RouteRecordRaw } from 'vue-router'

import Placeholder from '../../views/Placeholder.vue'

/**
 * kanban 域路由（I0-5 T3，设计 D-6）：「任务看板」占位页。
 * D-036 解隐口径：任务看板原属 F-02「V0.1 隐藏」范围，2026-08-25 用户裁决随协同编排拉进当前版本
 * （编排引擎 TS 重写 + 任务看板 + 内置 team 协同编排执行），故入口解隐为占位路由；
 * L5 任务看板线落地（SSE 消费 + 看板 UI）前为占位页。workflow 编排入口仍不渲染（留 L2，同 D-036）。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const kanbanRoutes: RouteRecordRaw[] = [
  {
    path: 'kanban',
    component: Placeholder,
    props: { title: '任务看板', description: '任务看板即将上线（L5 看板线落地前为占位页）' },
  },
]
