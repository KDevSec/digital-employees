export interface NavigationItem {
  label: string
  path: string
  permission?: string
}

export interface NavigationGroup {
  label: string
  items: NavigationItem[]
}

export interface NavigationTree {
  standalone: NavigationItem[]
  groups: NavigationGroup[]
}

const NAV_GROUPS = (t: (key: string) => string): NavigationGroup[] => [
  {
    label: t('nav.group.digitalEmployees'),
    items: [
      { label: t('nav.workbenches'), path: '/app/workbenches', permission: 'workbench.read' },
      { label: t('nav.enrollments'), path: '/app/enrollments', permission: 'workbench.enrollment.review' },
    ],
  },
  {
    label: t('nav.group.platformAdmin'),
    items: [
      { label: t('nav.packages'), path: '/app/packages', permission: 'package.manage' },
      { label: t('nav.audit'), path: '/app/audit', permission: 'audit.read' },
      { label: t('nav.systemLogs'), path: '/app/system-logs', permission: 'system.logs.read' },
    ],
  },
  {
    label: t('nav.group.systemAdmin'),
    items: [
      { label: t('nav.users'), path: '/app/users', permission: 'role.manage' },
      { label: t('nav.feedback'), path: '/app/feedback' },
      { label: t('nav.settings'), path: '/app/settings', permission: 'platform.settings.manage' },
    ],
  },
]

export function navigationForPermissions(
  permissions: string[],
  t: (key: string) => string,
): NavigationTree {
  const allowed = new Set(permissions)
  const visible = (item: NavigationItem) => !item.permission || allowed.has(item.permission)
  const standalone = [{ label: t('nav.overview'), path: '/app/overview' }].filter(visible)
  const groups = NAV_GROUPS(t)
    .map((group) => ({ label: group.label, items: group.items.filter(visible) }))
    .filter((group) => group.items.length > 0)
  return { standalone, groups }
}
