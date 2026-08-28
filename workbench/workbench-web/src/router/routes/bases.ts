import type { RouteRecordRaw } from 'vue-router'

import BasesView from '../../views/BasesView.vue'

/**
 * bases 域路由（D-bb01）：「底座与环境」真页——两张卡始终在、CLI 探测、登记名单安装。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const basesRoutes: RouteRecordRaw[] = [
  {
    path: 'bases',
    component: BasesView,
  },
]
