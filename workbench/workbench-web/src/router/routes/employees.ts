import type { RouteRecordRaw } from 'vue-router'

import CreateWizard from '../../views/CreateWizard.vue'
import EmployeesView from '../../views/EmployeesView.vue'

/**
 * employees 域路由（I0-5 T3，设计 D-6）：「我的员工」花名册页 + 「＋新建员工」向导入口。
 *
 * 历史：I0-5 T3 起为占位页（Placeholder）；L1 Task 13 追加 `employees/new` → CreateWizard（向导骨架）；
 * L1 Task 17 替换 `employees` 占位页为真视图 EmployeesView（花名册卡片 grid + 空态引导 + 新建入口）。
 *
 * 子记录相对路径：挂 router/index.ts 的 Layout 父记录 children 下（D-5 登录态业务页统一布局）。
 * 守卫沿用 D-7（未认证重定向 '/'），无需新增守卫逻辑。
 */
export const employeesRoutes: RouteRecordRaw[] = [
  {
    path: 'employees',
    name: 'employees',
    component: EmployeesView,
  },
  {
    path: 'employees/new',
    name: 'employees-new',
    component: CreateWizard,
  },
]
