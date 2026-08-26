import { createRouter, createWebHistory } from 'vue-router'

import Layout from '../components/nav/Layout.vue'
import { setupRouterGuard } from './guard'
import { accessRoutes } from './routes/access'
import { basesRoutes } from './routes/bases'
import { employeesRoutes } from './routes/employees'
import { kanbanRoutes } from './routes/kanban'

// 路由汇总（I0-5 T1 立约，设计 D-4 同构约定）：路由表 = 各域文件导出数组的静态拼接，一行一域。
// I1 各线在此追加域：新建 routes/<domain>.ts 导出 <domain>Routes（登录态业务域导出相对路径子记录），
// 并在下方对应位置加一行（业务域 → Layout children；access 型全屏域 → 顶层）。
//
// 布局结构（I0-5 T3，设计 D-5）：
// - access 域 '/' 顶层独立——接入页全屏无侧栏（唯一未登录可达页）；
// - 业务三域为 Layout 父记录 children（一行一域），跨域切换 matched[0] 不变 → Layout 不重挂。
//   Layout 父记录与 access 同为顶层 path '/'：vue-router 4 matcher 对同分记录按注册序取先者
//   （4.6.4 源码+探针实证：等分保持插入序、resolve 首个命中）→ access 行必须在 Layout 父记录
//   之前，'/' 精确命中接入页、'/employees' 等命中 Layout 子路由；test/router.test.ts 的
//   resolve("/") 断言是该顺序约束的回归保险，勿调换两行顺序。
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...accessRoutes,
    {
      path: '/',
      component: Layout,
      children: [
        ...employeesRoutes,
        ...basesRoutes,
        ...kanbanRoutes,
      ],
    },
  ],
})

// 登录态守卫（I0-5 T3，设计 D-7）：首次导航拉一次 /api/state，未认证访问非 '/' 重定向 '/'
setupRouterGuard(router)
