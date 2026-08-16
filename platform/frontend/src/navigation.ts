export interface NavigationItem {
  label: string
  path: string
  permission?: string
}

const navigation: NavigationItem[] = [
  { label: '总览', path: '/app/overview' },
  { label: '工作台', path: '/app/workbenches', permission: 'workbench.read' },
  { label: '接入申请', path: '/app/enrollments', permission: 'workbench.enrollment.review' },
  { label: '审计', path: '/app/audit', permission: 'audit' },
  { label: '安装包', path: '/app/packages', permission: 'package.manage' },
  { label: '组织管理', path: '/app/organization', permission: 'role.manage' },
  { label: '权限配置', path: '/app/permissions', permission: 'role.manage' },
  { label: '平台设置', path: '/app/settings', permission: 'platform.settings.manage' },
]

export function navigationForPermissions(permissions: string[]): NavigationItem[] {
  const allowed = new Set(permissions)
  const hasAudit = permissions.some((permission) => permission.startsWith('audit.'))
  return navigation.filter(
    (item) => !item.permission || (item.permission === 'audit' ? hasAudit : allowed.has(item.permission)),
  )
}
