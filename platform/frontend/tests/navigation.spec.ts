import { describe, expect, it } from 'vitest'

import i18n from '../src/i18n'
import { navigationForPermissions } from '../src/navigation'

const t = i18n.global.t.bind(i18n.global)

describe('navigationForPermissions', () => {
  it('shows the merged user management page and no standalone organization/permissions pages to a system administrator', () => {
    const items = navigationForPermissions(
      [
        'workbench.read',
        'workbench.enrollment.review',
        'audit.read',
        'package.manage',
        'role.manage',
        'system.logs.read',
        'platform.settings.manage',
      ],
      t,
    )

    expect(items.map((item) => item.path)).toEqual([
      '/app/overview',
      '/app/workbenches',
      '/app/enrollments',
      '/app/audit',
      '/app/packages',
      '/app/users',
      '/app/system-logs',
      '/app/settings',
    ])
  })

  it('shows only overview and own workbenches to an employee', () => {
    expect(
      navigationForPermissions(['workbench.read', 'workbench.enroll'], t).map((item) => item.path),
    ).toEqual(['/app/overview', '/app/workbenches'])
  })
})
