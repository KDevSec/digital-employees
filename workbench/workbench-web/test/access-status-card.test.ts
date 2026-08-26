// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AccessStatusCard from '../src/components/access/AccessStatusCard.vue'
import type { AccessState, AccessStatus } from '../src/api/access'

/**
 * AccessStatusCard（I0-5 T2，设计 §3 迁移映射：demo ui.ts L28 `#state` 行 + 条件块）。
 * 模板插值自动转义天然消解 demo esc()。
 */

function fixture(overrides: Partial<AccessState> = {}): AccessState {
  return {
    installationId: 'inst-001',
    enrollmentId: 'enr-9',
    workbenchId: 'wb-7',
    status: 'ACTIVE',
    lastHeartbeatAt: '2026-08-25T10:00:00Z',
    authenticated: true,
    user: { name: '张三', preferred_username: 'zhangsan', email: 'z@corp.example' },
    ...overrides,
  }
}

/** demo locked 数组原样（ui.ts L28：不含 REVOKED/ACTIVE） */
const LOCKED_STATUSES: AccessStatus[] = ['NEW', 'PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'REJECTED', 'ERROR']

describe('AccessStatusCard（demo L28 全部行渲染）', () => {
  it('登录 ACTIVE 完整 fixture：六行齐全（企业用户/Installation ID/申请 ID/工作台 ID/状态徽章/最后心跳）', () => {
    const wrapper = mount(AccessStatusCard, { props: { state: fixture() } })
    const text = wrapper.text()
    expect(text).toContain('企业用户')
    expect(text).toContain('张三')
    expect(text).toContain('Installation ID')
    expect(text).toContain('inst-001')
    expect(text).toContain('申请 ID')
    expect(text).toContain('enr-9')
    expect(text).toContain('终端 ID')
    expect(text).toContain('wb-7')
    expect(text).toContain('状态')
    expect(text).toContain('已激活')
    expect(text).toContain('最后心跳')
    expect(text).toContain('2026-08-25T10:00:00Z')
  })

  it('可选字段缺失 → 显示 "-"（demo esc(value ?? \'-\') 语义）', () => {
    const wrapper = mount(AccessStatusCard, {
      props: {
        state: fixture({ enrollmentId: undefined, workbenchId: undefined, lastHeartbeatAt: undefined }),
      },
    })
    const dashes = wrapper.findAll('.row').map((row) => row.text())
    expect(dashes.some((row) => row.includes('申请 ID') && row.includes('-'))).toBe(true)
    expect(dashes.some((row) => row.includes('终端 ID') && row.includes('-'))).toBe(true)
    expect(dashes.some((row) => row.includes('最后心跳') && row.includes('-'))).toBe(true)
  })

  it('企业用户名回退链：name → preferred_username → 已登录（demo || 链）', () => {
    expect(mount(AccessStatusCard, { props: { state: fixture({ user: { preferred_username: 'lisi' } }) } }).text()).toContain('lisi')
    expect(mount(AccessStatusCard, { props: { state: fixture({ user: undefined }) } }).text()).toContain('已登录')
  })

  it('未登录：企业用户行「未登录」+「请先登录」提示块（demo notice 语义），无「能力已锁定」', () => {
    const wrapper = mount(AccessStatusCard, {
      props: { state: fixture({ authenticated: false, user: undefined, status: 'NEW' }) },
    })
    expect(wrapper.text()).toContain('未登录')
    expect(wrapper.text()).toContain('请先登录')
    expect(wrapper.text()).toContain('终端需要通过企业账号完成 Keycloak 认证。')
    expect(wrapper.text()).not.toContain('能力已锁定')
  })
})

describe('AccessStatusCard 徽章（statusLabel 文案 + statusBadgeClass 类名，demo badge 语义等价）', () => {
  it.each([
    ['NEW', '未提交', 'neutral'],
    ['PENDING_REVIEW', '待审批', 'pending'],
    ['APPROVED', '已批准待激活', 'pending'],
    ['COMPLETED', '已完成注册', 'pending'],
    ['ACTIVE', '已激活', 'ok'],
    ['REJECTED', '已拒绝', 'error'],
    ['REVOKED', '已吊销', 'error'],
    ['ERROR', '提交失败', 'error'],
  ] as [AccessStatus, string, string][])('%s → 文案 %s + 类 %s', (status, label, cls) => {
    const wrapper = mount(AccessStatusCard, { props: { state: fixture({ status }) } })
    const badge = wrapper.find('.badge')
    expect(badge.text()).toBe(label)
    expect(badge.classes()).toContain(cls)
  })
})

describe('AccessStatusCard 能力已锁定（demo locked 数组原样：NEW/PENDING_REVIEW/APPROVED/COMPLETED/REJECTED/ERROR）', () => {
  it.each(LOCKED_STATUSES)('登录且 %s → 显示「能力已锁定」', (status) => {
    const wrapper = mount(AccessStatusCard, { props: { state: fixture({ status }) } })
    expect(wrapper.text()).toContain('能力已锁定')
    expect(wrapper.text()).toContain('接入申请审批通过并完成本机激活后，才可发送心跳和使用其他终端能力。')
  })

  it.each([['ACTIVE'], ['REVOKED']] as [AccessStatus][])('登录且 %s → 不显示锁定提示（demo 数组不含）', (status) => {
    const wrapper = mount(AccessStatusCard, { props: { state: fixture({ status }) } })
    expect(wrapper.text()).not.toContain('能力已锁定')
  })
})

describe('AccessStatusCard 异常条件块（demo REJECTED/ERROR 态 notice）', () => {
  it('rejectionReason 存在 → 「拒绝原因」块含原因文本', () => {
    const wrapper = mount(AccessStatusCard, {
      props: { state: fixture({ status: 'REJECTED', rejectionReason: '复核未通过：组织路径不在授权范围' }) },
    })
    expect(wrapper.text()).toContain('拒绝原因')
    expect(wrapper.text()).toContain('复核未通过：组织路径不在授权范围')
  })

  it('error 存在 → 「申请异常」块含异常文本', () => {
    const wrapper = mount(AccessStatusCard, {
      props: { state: fixture({ status: 'ERROR', error: '自动提交接入申请失败' }) },
    })
    expect(wrapper.text()).toContain('申请异常')
    expect(wrapper.text()).toContain('自动提交接入申请失败')
  })

  it('模板插值自动转义（esc() 迁移消解）：原因含 <b> 不产生元素', () => {
    const wrapper = mount(AccessStatusCard, {
      props: { state: fixture({ status: 'REJECTED', rejectionReason: '含 <b>加粗</b> 标记' }) },
    })
    expect(wrapper.find('.notice b').exists()).toBe(false)
    expect(wrapper.text()).toContain('含 <b>加粗</b> 标记')
  })

  it('无 rejectionReason/error → 不渲染两个异常块', () => {
    const wrapper = mount(AccessStatusCard, { props: { state: fixture() } })
    expect(wrapper.text()).not.toContain('拒绝原因')
    expect(wrapper.text()).not.toContain('申请异常')
  })
})
