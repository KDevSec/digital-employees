import type { RouteRecordRaw } from 'vue-router'
import Home from '../../views/Home.vue'

/**
 * access 域路由（I0-5 T1，设计 D-4：web 路由分域约定，与 service 侧 src/server/routes/<domain>.ts 同构——
 * 每业务域一文件导出 RouteRecordRaw[]，router/index.ts 汇总一行一域）。
 * 当前仅 `/` 接入页（D-6 路由骨架；暂装 Home 占位组件——组件替换属 T2/F-03 AccessView）。
 * I1 各线新增域：新建 routes/<domain>.ts 导出 <domain>Routes，并在 router/index.ts 汇总加一行
 * （employees/bases/kanban/auth 等，域名与 service 侧对应）。
 */
export const accessRoutes: RouteRecordRaw[] = [
  { path: '/', component: Home },
]
