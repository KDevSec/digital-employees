import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PermissionsPage from '../src/features/permissions/PermissionsPage.vue'


describe('PermissionsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers custom roles and organization-scoped grants', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = String(input)
      const payload = path.includes('/permissions')
        ? [{ code: 'organization.read', description: 'Read organizations', risk_level: 'LOW', delegable: true }]
        : []
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const wrapper = mount(PermissionsPage)
    await flushPromises()

    expect(wrapper.text()).toContain('自定义角色')
    expect(wrapper.text()).toContain('授权范围')
    expect(wrapper.text()).toContain('organization.read')
  })
})
