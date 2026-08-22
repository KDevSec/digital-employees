import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from './stores/session'
import PublicHome from './features/public/PublicHome.vue'
import PublicHistory from './features/public/PublicHistory.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: PublicHome },
    { path: '/history', component: PublicHistory },
    {
      path: '/app',
      component: () => import('./shell/AppShell.vue'),
      children: [
        { path: '', redirect: '/app/overview' },
        { path: 'overview', component: () => import('./features/overview/OverviewPage.vue') },
        { path: 'feedback', component: () => import('./features/feedback/FeedbackPage.vue') },
        { path: 'workbenches', component: () => import('./features/workbenches/WorkbenchesPage.vue'), meta: { permission: 'workbench.read' } },
        { path: 'enrollments', component: () => import('./features/enrollments/EnrollmentsPage.vue'), meta: { permission: 'workbench.enrollment.review' } },
        { path: 'audit', component: () => import('./features/audit/AuditPage.vue'), meta: { permission: 'audit.read' } },
        { path: 'packages', component: () => import('./features/packages/PackagesPage.vue'), meta: { permission: 'package.manage' } },
        { path: 'users', component: () => import('./features/users/UsersPage.vue'), meta: { permission: 'role.manage' } },
        { path: 'system-logs', component: () => import('./features/system-logs/SystemLogsPage.vue'), meta: { permission: 'system.logs.read' } },
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
  if (permission && !session.can(permission)) return '/app/overview'
  return true
})

export default router
