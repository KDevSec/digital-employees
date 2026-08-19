import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkbenchesPage from '../src/features/workbenches/WorkbenchesPage.vue'

function mockFetch() {
  const calls: string[] = []
  const handler = vi.fn(async (input: string | URL | Request) => {
    const path = String(input)
    calls.push(path)
    return new Response(JSON.stringify({
      items: [{
        id: 'wb-1', display_name: 'Local WB', owner_principal_id: 'p-1', owner_display_name: '李四',
        org_path: 'Example Corp-CBB2-Team2', domain_id: 'domain-a', reported_os: 'linux',
        reported_arch: 'x64', reported_version: '0.1.0', status: 'ACTIVE',
        credential_status: 'ACTIVE', connection_status: 'ONLINE', created_at: '2026-08-19T08:00:00Z',
      }],
      total: 1, offset: 0, limit: 20,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  handler.calls = calls
  return handler
}

describe('WorkbenchesPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows owner organization path and searches by person, department or team', async () => {
    const fetch = mockFetch()
    vi.stubGlobal('fetch', fetch)

    const wrapper = mount(WorkbenchesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('李四')
    expect(wrapper.text()).toContain('Example Corp-CBB2-Team2')

    await wrapper.find('input[type="search"]').setValue('存储研发部')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetch.calls.at(-1)).toContain('q=%E5%AD%98%E5%82%A8%E7%A0%94%E5%8F%91%E9%83%A8')
  })

  it('renders pending enrollment rows as waiting for approval', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: 'er-1', kind: 'enrollment', enrollment_id: 'er-1', display_name: 'Pending WB',
        owner_principal_id: 'p-1', owner_display_name: '张三', org_path: 'ieisystem-研发一处',
        domain_id: 'domain-a', reported_os: 'linux', reported_arch: 'x64', reported_version: '0.1.0',
        status: 'PENDING_REVIEW', credential_status: 'PENDING', connection_status: 'PENDING',
        created_at: '2026-08-19T08:00:00Z',
      }],
      total: 1, offset: 0, limit: 20,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const wrapper = mount(WorkbenchesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('待审批')
    expect(wrapper.text()).toContain('接入申请')
    expect(wrapper.text()).toContain('ieisystem-研发一处')
    expect(wrapper.find('button.danger').exists()).toBe(false)
  })
})
