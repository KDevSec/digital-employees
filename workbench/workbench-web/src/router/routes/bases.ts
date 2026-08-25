import type { RouteRecordRaw } from 'vue-router'

import Placeholder from '../../views/Placeholder.vue'

/**
 * bases 域路由（I0-5 T3，设计 D-6）：「底座与环境」占位页。
 * 线归属：底座在场探测 B-06 / 安装报告 B-04 / 卸载 B-05 等由 L2 员工安装线填充。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const basesRoutes: RouteRecordRaw[] = [
  {
    path: 'bases',
    component: Placeholder,
    props: { title: '底座与环境', description: '底座探测与安装管理即将上线（L2 安装线填充）' },
  },
]
