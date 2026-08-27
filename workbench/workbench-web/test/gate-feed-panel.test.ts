// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GateFeedPanel from '../src/components/kanban/GateFeedPanel.vue'
import type { GateRecord } from '../src/stores/kanban'

/**
 * 评审流水卡（L5 v0.2，对齐 1.0 gtl 时间线形态）：时间·闸·评审方·verdict·轮次·issues 细行；
 * 人工 confirm 在场 amber（纪律④）；最新在上 cap 50。
 */

const rec = (p: Partial<GateRecord>): GateRecord => ({
  gate: 'g-code-review',
  kind: 'review',
  node: 'n2-impl',
  verdict: 'PASS',
  iter: 1,
  reviewer: 'reviewer-expert',
  actor: 'reviewer-expert',
  ts: '2026-08-27T02:00:00.000Z',
  ...p,
})

describe('GateFeedPanel（评审流水）', () => {
  it('行要素：时间/闸/评审方/verdict 配色/轮次', () => {
    const w = mount(GateFeedPanel, {
      props: { records: [rec({ verdict: 'PASS' }), rec({ verdict: 'FAIL', iter: 2, issues: ['边界 X'] })] },
    })
    const rows = w.findAll('.gtl-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).toContain('pass')
    expect(rows[1].classes()).toContain('fail')
    expect(rows[0].text()).toContain('g-code-review')
    expect(rows[0].text()).toContain('reviewer-expert')
    expect(rows[1].text()).toContain('第2轮')
    // FAIL 行 issues 细行在场
    expect(rows[1].find('.gissues').text()).toContain('边界 X')
  })

  it('人工 confirm：human 类 + 「人工」标注（纪律④）', () => {
    const w = mount(GateFeedPanel, {
      props: { records: [rec({ kind: 'acceptance', verdict: 'approve', reviewer: 'human', actor: 'human' })] },
    })
    expect(w.find('.gtl-row').classes()).toContain('human')
    expect(w.text()).toContain('人工')
  })

  it('最新在上（ts 降序）+ cap 50', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      rec({ ts: `2026-08-27T02:${String(i).padStart(2, '0')}:00.000Z` }),
    )
    const w = mount(GateFeedPanel, { props: { records: many } })
    const rows = w.findAll('.gtl-row')
    expect(rows).toHaveLength(50)
    expect(rows[0].text()).toContain('02:59') // 最新
    expect(rows[49].text()).toContain('02:10')
  })

  it('空流水：占位文案', () => {
    const w = mount(GateFeedPanel, { props: { records: [] } })
    expect(w.text()).toContain('暂无评审流水')
  })
})
