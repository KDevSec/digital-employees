// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DispatchCard from '../src/components/kanban/DispatchCard.vue'
import NodeChip from '../src/components/kanban/NodeChip.vue'
import StageLane from '../src/components/kanban/StageLane.vue'
import type { NodeView, StageView } from '../src/stores/derive-board'
import type { ActiveDispatch } from '../src/stores/kanban'

/**
 * 看板基础三件（L5 看板线 T6）：NodeChip（节点 chip 四态 + gate 徽记）/
 * StageLane（阶段泳道：名/计数/节点列表/派发卡落位）/ DispatchCard（员工派发卡 pulse 动画）。
 * 视觉语言对齐原型 workbench.html（nc-node/lane/task-card/board-pulse）；动画断类名不断效果。
 */

function nv(partial: Partial<NodeView> & { id: string }): NodeView {
  return {
    name: partial.id,
    kind: 'action',
    state: 'pending',
    humanGate: false,
    activeDispatch: null,
    ...partial,
  }
}

describe('NodeChip（节点 chip）', () => {
  it('done 态：✓ 前缀 + done 类', () => {
    const w = mount(NodeChip, { props: { node: nv({ id: 'n0-req', name: '需求核验', state: 'done' }) } })
    expect(w.find('.nc-node').classes()).toContain('done')
    expect(w.text()).toContain('✓ 需求核验')
  })

  it('active 态：cur 类；paused 态：paused 类（amber 高亮锚）', () => {
    const active = mount(NodeChip, { props: { node: nv({ id: 'x', state: 'active' }) } })
    expect(active.find('.nc-node').classes()).toContain('cur')
    const paused = mount(NodeChip, { props: { node: nv({ id: 'x', state: 'paused' }) } })
    expect(paused.find('.nc-node').classes()).toContain('paused')
  })

  it('pending 态：无状态类；gate 节点带 ⚖ 徽记类', () => {
    const pending = mount(NodeChip, { props: { node: nv({ id: 'x' }) } })
    expect(pending.find('.nc-node').classes()).not.toContain('done')
    const gate = mount(NodeChip, { props: { node: nv({ id: 'g-x', kind: 'gate' }) } })
    expect(gate.find('.nc-node').classes()).toContain('gate')
    expect(gate.text()).toContain('⚖')
  })

  it('human_gate 节点带 human 类（人工闸标记）', () => {
    const w = mount(NodeChip, { props: { node: nv({ id: 'n0-req', humanGate: true }) } })
    expect(w.find('.nc-node').classes()).toContain('human')
  })
})

describe('DispatchCard（员工派发卡）', () => {
  const d: ActiveDispatch = { dispatchId: 'D-2', emp: 'req-clarifier', node: 'n0-req', sinceSeq: 5 }
  it('渲染员工 display 名 + 所在节点（id 兜底） + running 类（pulse 动画锚）', () => {
    const w = mount(DispatchCard, { props: { dispatch: d, displayName: '需求澄清师' } })
    expect(w.text()).toContain('需求澄清师')
    expect(w.text()).toContain('n0-req')
    expect(w.find('.dispatch-card').classes()).toContain('running')
    expect(w.find('.pulse').exists()).toBe(true)
  })

  it('displayName 缺映射时回退 emp id', () => {
    const w = mount(DispatchCard, { props: { dispatch: d, displayName: 'req-clarifier' } })
    expect(w.text()).toContain('req-clarifier')
  })
})

describe('StageLane（阶段泳道）', () => {
  const stage: StageView = {
    name: '需求核验',
    nodes: [
      nv({ id: 'n0-req', name: '需求核验', state: 'done' }),
      nv({ id: 'g-req-review', name: '需求评审', kind: 'gate', state: 'active' }),
    ],
  }

  it('阶段名 + 计数 done/total + 每节点一枚 chip', () => {
    const w = mount(StageLane, { props: { stage } })
    expect(w.find('.lane-head').text()).toContain('需求核验')
    expect(w.find('.cnt').text()).toBe('1/2')
    expect(w.findAll('.nc-node')).toHaveLength(2)
  })

  it('节点活跃派发时该节点下渲染 DispatchCard（落位锚）', () => {
    const withDispatch: StageView = {
      ...stage,
      nodes: [
        stage.nodes[0],
        {
          ...stage.nodes[1],
          activeDispatch: { dispatchId: 'D-3', emp: 'reviewer-expert', node: 'g-req-review', sinceSeq: 8 },
        },
      ],
    }
    const w = mount(StageLane, { props: { stage: withDispatch, employees: { 'reviewer-expert': '评审专家' } } })
    expect(w.findAllComponents(DispatchCard)).toHaveLength(1)
    expect(w.text()).toContain('评审专家')
  })

  it('无派发的节点下不出员工卡', () => {
    const w = mount(StageLane, { props: { stage } })
    expect(w.findAllComponents(DispatchCard)).toHaveLength(0)
  })
})
