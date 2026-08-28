import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TeamTerminalsPage from '../src/features/terminals/TeamTerminalsPage.vue'
import MyTerminalsPage from '../src/features/terminals/MyTerminalsPage.vue'

function rosterResponse(items: unknown[]) {
  return new Response(JSON.stringify({ items, total: items.length, offset: 0, limit: 20 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const onlineRow = {
  kind: 'roster', id: 'wb-1', principal_id: 'p-online', owner_principal_id: 'p-online',
  owner_display_name: '李四', username: 'lisi', email: 'lisi@example.com', org_path: 'Example Corp-研发部',
  install_status: 'ONLINE', status: 'ONLINE', display_name: '终端 online', hostname: 'online-host',
  ip_address: '203.0.113.11', mac_address: 'aa:bb:cc:dd:ee:11', installation_id: 'install-uuid-1',
  reported_version: '2.0.0', reported_os: 'linux', reported_arch: 'x64',
  last_heartbeat_at: '2026-08-27T08:00:00Z',
}
const nakedRow = {
  kind: 'roster', id: null, principal_id: 'p-naked', owner_principal_id: 'p-naked',
  owner_display_name: '王五', username: 'wangwu', email: 'wangwu@example.com', org_path: 'Example Corp-研发部',
  install_status: 'NOT_INSTALLED', status: 'NOT_INSTALLED',
}

describe('TeamTerminalsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders roster rows with sequence numbers and not-installed reminder actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rosterResponse([onlineRow, nakedRow])))
    const wrapper = mount(TeamTerminalsPage)
    await flushPromises()

    const body = wrapper.find('tbody')
    const cells = body.findAll('tr')[0].findAll('td')
    expect(cells[0].text()).toBe('1')
    expect(body.findAll('tr')[1].findAll('td')[0].text()).toBe('2')

    expect(wrapper.text()).toContain('李四')
    expect(wrapper.text()).toContain('王五')
    expect(wrapper.text()).toContain('未安装')
    // 024：未安装状态以状态徽章为唯一指示——未安装成员行（王五）只出现一次「未安装」；
    // IP 列为「—」，成员名下不再重复小字（此前一行三处重复）
    const nakedRowCells = body.findAll('tr')[1].findAll('td')
    const nakedText = nakedRowCells.map((cell) => cell.text()).join('|')
    expect(nakedText.split('未安装')).toHaveLength(2) // 仅状态徽章一处
    expect(nakedText).toContain('—')

    const remindButtons = wrapper.findAll('button').filter((b) => b.text() === '催安装')
    expect(remindButtons).toHaveLength(1)

    expect(wrapper.text()).toContain('一键催装')
  })

  it('opens a detail drawer with full terminal metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rosterResponse([onlineRow])))
    const wrapper = mount(TeamTerminalsPage)
    await flushPromises()

    await wrapper.find('tbody tr').trigger('click')
    await flushPromises()

    expect(wrapper.find('.drawer').exists()).toBe(true)
    expect(wrapper.find('.drawer').text()).toContain('online-host')
    // 024：单值平台观测 IP + 单值主 MAC；安装 ID 为唯一展示标识
    expect(wrapper.find('.drawer').text()).toContain('203.0.113.11')
    expect(wrapper.find('.drawer').text()).toContain('aa:bb:cc:dd:ee:11')
    expect(wrapper.find('.drawer').text()).toContain('install-uuid-1')
  })
})

describe('MyTerminalsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows not-installed empty state when the employee has no terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rosterResponse([{ ...nakedRow, principal_id: 'self', owner_principal_id: 'self' }])))
    const wrapper = mount(MyTerminalsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('你尚未安装研发零处数字员工终端')
  })
})
