import { describe, expect, it } from 'vitest'

import { navigationForPermissions } from '../src/navigation'


describe('navigationForPermissions', () => {
  it('shows all management pages to a system administrator', () => {
    const items = navigationForPermissions([
      'workbench.read',
      'workbench.enrollment.review',
      'audit.all.read',
      'package.manage',
      'role.manage',
      'platform.settings.manage',
    ])

    expect(items.map((item) => item.path)).toEqual([
      '/app/overview',
      '/app/workbenches',
      '/app/enrollments',
      '/app/audit',
      '/app/packages',
      '/app/organization',
      '/app/permissions',
      '/app/settings',
    ])
  })

  it('shows only overview and own workbenches to an employee', () => {
    expect(navigationForPermissions(['workbench.read', 'workbench.enroll']).map((item) => item.path)).toEqual([
      '/app/overview',
      '/app/workbenches',
    ])
  })
})
