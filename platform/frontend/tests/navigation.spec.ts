import { describe, expect, it } from 'vitest'

import i18n from '../src/i18n'
import { navigationForPermissions } from '../src/navigation'

const t = i18n.global.t.bind(i18n.global)

function flatPaths(tree: ReturnType<typeof navigationForPermissions>): string[] {
  return [...tree.standalone, ...tree.groups.flatMap((g) => g.items)].map((i) => i.path)
}

describe('navigationForPermissions', () => {
  it('shows the merged user management page and no standalone organization/permissions pages to a system administrator', () => {
    const tree = navigationForPermissions(
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

    expect(flatPaths(tree)).toEqual([
      '/app/overview',
      '/app/workbenches',
      '/app/enrollments',
      '/app/packages',
      '/app/audit',
      '/app/system-logs',
      '/app/users',
      '/app/feedback',
      '/app/settings',
    ])
  })

  it('shows only overview and own workbenches to an employee', () => {
    expect(
      flatPaths(navigationForPermissions(['workbench.read', 'workbench.enroll'], t)),
    ).toEqual(['/app/overview', '/app/workbenches', '/app/feedback'])
  })
})
