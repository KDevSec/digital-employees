import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from './stores/session'
import PublicHome from './features/public/PublicHome.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: PublicHome },
    {
      path: '/app',
      component: () => import('./shell/AppShell.vue'),
      children: [
        { path: '', redirect: '/app/overview' },
        { path: 'overview', component: () => import('./features/overview/OverviewPage.vue') },
        { path: 'workbenches', component: () => import('./features/workbenches/WorkbenchesPage.vue'), meta: { permission: 'workbench.read' } },
        { path: 'enrollments', component: () => import('./features/enrollments/EnrollmentsPage.vue'), meta: { permission: 'workbench.enrollment.review' } },
        { path: 'audit', component: () => import('./features/audit/AuditPage.vue'), meta: { permissionPrefix: 'audit.' } },
        { path: 'packages', component: () => import('./features/packages/PackagesPage.vue'), meta: { permission: 'package.manage' } },
        { path: 'permissions', component: () => import('./features/permissions/PermissionsPage.vue'), meta: { permission: 'role.manage' } },
        { path: 'settings', component: () => import('./features/settings/SettingsPage.vue'), meta: { permission: 'platform.settings.manage' } },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.path.startsWith('/app')) return true
  const session = useSessionStore()
  if (!session.loaded && !(await session.load())) {
    window.location.assign(`/auth/login?return_to=${encodeURIComponent(to.fullPath)}`)
    return false
  }
  const permission = to.meta.permission as string | undefined
  const prefix = to.meta.permissionPrefix as string | undefined
  if (permission && !session.can(permission)) return '/app/overview'
  if (prefix && !session.permissions.some((item) => item.startsWith(prefix))) return '/app/overview'
  return true
})

export default router
