// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmpBand from '../src/components/kanban/EmpBand.vue'
import type { ActiveDispatch } from '../src/stores/kanban'

/**
 * 员工横条（L5 v0.2，对齐 1.0 empband）：当前派发员工横排
 * （avatar + display 名 + 所在节点 + 呼吸态）；数据 = task.activeDispatches。
 */

const D: ActiveDispatch[] = [
  { dispatchId: 'D-1', emp: 'reviewer-expert', node: 'g-req-review', sinceSeq: 8 },
  { dispatchId: 'D-2', emp: 'sec-compliance', node: 'n-adm', sinceSeq: 2 },
]

const EMP = { 'reviewer-expert': '评审专家', 'sec-compliance': '安全合规审核员' }

describe('EmpBand（员工横条）', () => {
  it('有派发：横排员工卡（avatar+display 名+节点名映射）+ running 呼吸类', () => {
    const w = mount(EmpBand, {
      props: {
        dispatches: D,
        employees: EMP,
        nodeNames: { 'g-req-review': '需求评审', 'n-adm': '准入' },
      },
    })
    const cards = w.findAll('.emp-item')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('评审专家')
    expect(cards[0].text()).toContain('需求评审')
    expect(cards[0].classes()).toContain('running')
  })

  it('display 缺映射回退 emp id', () => {
    const w = mount(EmpBand, { props: { dispatches: [D[0]], employees: {} } })
    expect(w.text()).toContain('reviewer-expert')
  })

  it('无派发：灰态提示「当前无派发」', () => {
    const w = mount(EmpBand, { props: { dispatches: [], employees: EMP } })
    expect(w.find('.emp-empty').text()).toContain('当前无派发')
  })
})
