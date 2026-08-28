import { describe, expect, it } from 'vitest'
import type { BaseCard } from '../src/api/bases'
import {
  addTargets,
  canPreview,
  modelLine,
  statusBadge,
  visibleCards,
} from '../src/views/bases-logic'

/**
 * 底座页规则（D-bb01）。jsdom 在本 worktree 的 Node 20 + undici 8 下无法启动，
 * 页面行为在此按纯函数缝测试；BasesView.vue 只接线这些函数。
 */

const remote: BaseCard[] = [
  { id: 'claude-code', label: 'Claude Code', present: true, version: '2.1.245', version_tested: '2.1.245', supported: true, employees_count: 9, last_install_at: null },
  { id: 'codebuddy', label: 'CodeBuddy', present: false, version: null, version_tested: '2.137.1', supported: null, employees_count: 4, last_install_at: null },
  { id: 'qoder', label: 'Qoder', present: true, version: '1.1.31', version_tested: '1.1.26', supported: true, employees_count: 2, last_install_at: null },
]

describe('visibleCards', () => {
  it('始终两张 CodeBuddy + Qoder，丢掉 claude-code；API 空也占位', () => {
    const cards = visibleCards(remote)
    expect(cards.map((c) => c.id)).toEqual(['codebuddy', 'qoder'])
    expect(cards.map((c) => c.label)).toEqual(['CodeBuddy', 'Qoder'])
    expect(visibleCards(null).map((c) => c.id)).toEqual(['codebuddy', 'qoder'])
    expect(visibleCards(null).every((c) => !c.present)).toBe(true)
  })
})

describe('statusBadge / modelLine', () => {
  it('未安装 / 未登录 / 在场可区分；未登录不是空列表文案', () => {
    const cb = remote[1]
    const qo = remote[2]
    expect(statusBadge(cb, undefined).text).toBe('未安装')
    expect(statusBadge(qo, { ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' }).text).toBe('未登录')
    expect(statusBadge(qo, { ok: true, models: [{ id: 'auto', label: 'auto' }] }).text).toBe('在场')
    expect(modelLine(qo, { ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' })).toBe('登录后可见')
    expect(modelLine(qo, { ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' })).not.toBe('暂无模型')
    expect(canPreview({ ok: false, code: 'NOT_LOGGED_IN', message: '登录后可见' })).toBe(false)
    expect(canPreview({ ok: true, models: [{ id: 'auto', label: 'auto' }] })).toBe(true)
    expect(modelLine(
      { ...qo, present: true },
      { ok: false, code: 'CLI_FAILED', message: '模型命令尚未登记' },
    )).toBe('模型命令尚未登记')
    expect(canPreview({ ok: false, code: 'CLI_FAILED', message: '模型命令尚未登记' })).toBe(false)
  })
})

describe('addTargets', () => {
  it('添加名单 = 登记且未在场（本期缺的那张）', () => {
    const targets = addTargets(visibleCards(remote))
    expect(targets.map((c) => c.id)).toEqual(['codebuddy'])
  })
})
