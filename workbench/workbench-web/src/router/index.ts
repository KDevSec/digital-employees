import { createRouter, createWebHistory } from 'vue-router'
import { accessRoutes } from './routes/access'

// 路由汇总（I0-5 T1，设计 D-4 同构约定）：路由表 = 各域文件导出数组的静态拼接，一行一域。
// I1 各线在此追加域：新建 routes/<domain>.ts 导出 <domain>Routes，并在下方 routes 数组加一行
// （employees/bases/kanban/auth 等；域与 service 侧 src/server/routes/<domain>.ts 一一对应）。
// V0.1 仅 access 域 `/` → AccessView（I0-5 T2：F-03 登录与接入页，Home 占位页已退役）
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...accessRoutes,
  ],
})
