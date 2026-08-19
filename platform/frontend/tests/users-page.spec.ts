import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UsersPage from '../src/features/users/UsersPage.vue'

function mockFetch() {
  const calls: { path: string; init?: RequestInit }[] = []
  const handler = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    let payload: unknown = []
    if (path.startsWith('/api/v1/iam/principals')) {
      payload = {
        items: [
          {
            id: 'u1', username: 'alice', display_name: 'Alice', email: null,
            domain_id: 'domain-east', domain_name: '华东域',
            department_id: 'dept-rd', department_name: '研发部', team_id: 'team-fe',
            org_path: '华东域 / 研发部',
            status: 'ACTIVE', roles: [],
          },
        ],
        total: 1,
        offset: 0,
        limit: 20,
      }
    } else if (path === '/api/v1/iam/domains') {
      payload = [{ id: 'domain-east', name: '华东域', status: 'ACTIVE' }]
    } else if (path.startsWith('/api/v1/iam/departments')) {
      payload = {
        items: [
          { id: 'dept-rd', domain_id: 'domain-east', domain_name: '华东域', name: '研发部', status: 'ACTIVE' },
          { id: 'dept-ops', domain_id: 'domain-east', domain_name: '华东域', name: '运营部', status: 'ACTIVE' },
        ],
        total: 2,
        offset: 0,
        limit: 100,
      }
    } else if (path.startsWith('/api/v1/iam/teams')) {
      payload = [{ id: 'team-fe', department_id: 'dept-rd', name: '前端组', status: 'ACTIVE' }]
    } else if (path.startsWith('/api/v1/principals/u1/org-context')) {
      payload = {
        principal_id: 'u1',
        domain: { id: 'domain-east', name: '华东域' },
        department: { id: 'dept-rd', name: '研发部' },
        team: { id: 'team-fe', name: '前端组' },
        primary_org: { id: 'org-rd', name: '研发部组织' },
        primary_org_path: [
          { id: 'domain-east', name: '华东域', org_type: 'DOMAIN' },
          { id: 'org-rd', name: '研发部组织', org_type: 'DEPARTMENT' },
        ],
        collaborations: [],
      }
    } else if (path === '/api/v1/authorization/overview') {
      payload = {
        builtin_roles: [
          { role_code: 'EMPLOYEE', label: '员工' },
          { role_code: 'DEPARTMENT_ADMIN', label: '部门管理员' },
        ],
        custom_roles: [],
        fixed_assignments: [],
        scoped_grants: [],
        domains: [{ id: 'domain-east', name: '华东域' }],
        org_nodes: [
          { id: 'domain-east', name: '华东域', domain_id: 'domain-east', parent_id: null, org_type: 'DOMAIN' },
          { id: 'dept-rd', name: '研发部', domain_id: 'domain-east', parent_id: 'domain-east', org_type: 'DEPARTMENT' },
          { id: 'dept-ops', name: '运营部', domain_id: 'domain-east', parent_id: 'domain-east', org_type: 'DEPARTMENT' },
          { id: 'team-fe', name: '前端组', domain_id: 'domain-east', parent_id: 'dept-rd', org_type: 'TEAM' },
        ],
        principals: [],
      }
    }
    calls.push({ path, init })
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  handler.calls = calls
  return handler
}

describe('UsersPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the user org path in the department column', async () => {
    const fetch = mockFetch()
    vi.stubGlobal('fetch', fetch)

    const wrapper = mount(UsersPage)
    await flushPromises()

    const headers = wrapper.findAll('thead th').map((th) => th.text())
    expect(headers).not.toContain('公司域')
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('华东域 / 研发部')
  })

  it('filters users by a multi-select collapsible org tree', async () => {
    const fetch = mockFetch()
    vi.stubGlobal('fetch', fetch)

    const wrapper = mount(UsersPage)
    await flushPromises()

    const filterBtn = wrapper.find('.org-filter-btn')
    await filterBtn.trigger('click')
    await flushPromises()

    const popover = wrapper.find('.org-filter-popover')
    expect(popover.exists()).toBe(true)

    await popover.find('button.org-scope-caret').trigger('click')
    await flushPromises()
    const deptCheck = popover.findAll('.org-scope-check').find((c) => c.text().includes('研发部'))!
    await deptCheck.find('input').setValue(true)
    await flushPromises()

    await popover.findAll('button').find((b) => b.text().includes('应用'))!.trigger('click')
    await flushPromises()

    const principalsCall = fetch.calls.filter((c) => c.path.startsWith('/api/v1/iam/principals')).pop()!
    const params = new URLSearchParams(principalsCall.path.split('?')[1] || '')
    expect(params.getAll('department_ids')).toContain('dept-rd')
  })

  it('uses a collapsible scope tree for department admin assignment', async () => {
    const fetch = mockFetch()
    vi.stubGlobal('fetch', fetch)

    const wrapper = mount(UsersPage)
    await flushPromises()

    await wrapper.findAll('table tbody tr td')[1].trigger('click')
    await flushPromises()

    const setPermBtn = wrapper.findAll('button').find((b) => b.text().includes('设置权限'))!
    await setPermBtn.trigger('click')
    await flushPromises()

    const roleSelect = wrapper.find('.assign-form select')
    await roleSelect.setValue('DEPARTMENT_ADMIN')
    await flushPromises()

    const treeBox = wrapper.find('.scope-tree-box')
    expect(treeBox.text()).toContain('华东域')
    expect(treeBox.text()).not.toContain('研发部')
    expect(treeBox.findAll('.org-scope-check').length).toBe(1)

    await wrapper.findAll('button.org-scope-caret')[0].trigger('click')
    await flushPromises()
    expect(treeBox.text()).toContain('研发部')

    const rdCheck = wrapper.findAll('.org-scope-check').find((c) => c.text().includes('研发部'))!
    await rdCheck.find('input').setValue(true)
    await flushPromises()

    const submit = wrapper.find('.assign-form button.primary')
    await submit.trigger('submit')
    await flushPromises()

    const post = fetch.calls.find((c) => c.path === '/api/v1/role-assignments')
    expect(post).toBeTruthy()
    const body = JSON.parse((post!.init as any)?.body)
    expect(body.role_code).toBe('DEPARTMENT_ADMIN')
    expect(body.scope_type).toBe('DEPARTMENT_SET')
    expect(body.department_ids).toEqual(['dept-rd'])
    expect(body.domain_id).toBe('domain-east')
  })
})
