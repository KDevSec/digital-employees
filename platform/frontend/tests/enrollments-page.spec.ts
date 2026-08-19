import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EnrollmentsPage from '../src/features/enrollments/EnrollmentsPage.vue'

describe('EnrollmentsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows applicant name and organization path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: 'er-1', owner_principal_id: 'p-1', owner_display_name: '张三', org_path: 'Example Corp-存储研发部-基础处',
        display_name: 'Workbench local', workbench_version: '0.1.0', os: 'linux', arch: 'x64',
        status: 'PENDING_REVIEW', created_at: '2026-08-19T08:00:00Z',
      }],
      total: 1, offset: 0, limit: 20,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const wrapper = mount(EnrollmentsPage)
    await flushPromises()

    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('Example Corp-存储研发部-基础处')
  })
})
