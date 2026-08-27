import type { RouteRecordRaw } from 'vue-router'

import CreateWizard from '../../views/CreateWizard.vue'
import Placeholder from '../../views/Placeholder.vue'

/**
 * employees 域路由（I0-5 T3，设计 D-6）：「我的员工」占位页（侧栏默认选中项）。
 * 线归属：员工列表 E-10 由 L4 员工运行线填充、「＋新建员工」向导入口 E-11 由 L1 员工新建线填充。
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 *
 * L1 Task 13：追加 `employees/new` → CreateWizard（向导骨架）；与 `employees` 同为 Layout 父记录
 * children 下的相对路径子记录（vue-router 4 按更具体路径优先匹配，`employees/new` 命中独立记录，
 * `employees` 仍精确命中占位页）。守卫沿用 D-7（未认证重定向 '/'），无需新增守卫逻辑。
 */
export const employeesRoutes: RouteRecordRaw[] = [
  {
    path: 'employees',
    component: Placeholder,
    props: { title: '我的员工', description: '员工列表即将上线（L1 新建 / L4 运行线填充）' },
  },
  {
    path: 'employees/new',
    name: 'employees-new',
    component: CreateWizard,
  },
]
