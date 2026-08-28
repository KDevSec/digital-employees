import type { RouteRecordRaw } from 'vue-router'

import BasesView from '../../views/BasesView.vue'

/**
 * bases 域路由：「底座与环境」页面（L2 安装线填充 I0-5 预留版面）。
 * 页面 = 底座在场探测卡片（B-06）+ 模型档位配置面（D-062）；
 * 安装报告 B-04 / 卸载 B-05 后续同版面扩展。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 */
export const basesRoutes: RouteRecordRaw[] = [
  {
    path: 'bases',
    component: BasesView,
  },
]
