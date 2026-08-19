export interface NavigationItem {
  label: string
  path: string
  permission?: string
}

export function navigationForPermissions(
  permissions: string[],
  t: (key: string) => string,
): NavigationItem[] {
  const nav: NavigationItem[] = [
    { label: t('nav.overview'), path: '/app/overview' },
    { label: t('nav.workbenches'), path: '/app/workbenches', permission: 'workbench.read' },
    { label: t('nav.enrollments'), path: '/app/enrollments', permission: 'workbench.enrollment.review' },
    { label: t('nav.audit'), path: '/app/audit', permission: 'audit.read' },
    { label: t('nav.packages'), path: '/app/packages', permission: 'package.manage' },
    { label: t('nav.users'), path: '/app/users', permission: 'role.manage' },
    { label: t('nav.systemLogs'), path: '/app/system-logs', permission: 'system.logs.read' },
    { label: t('nav.settings'), path: '/app/settings', permission: 'platform.settings.manage' },
  ]
  const allowed = new Set(permissions)
  return nav.filter(
    (item) => !item.permission || allowed.has(item.permission),
  )
}
