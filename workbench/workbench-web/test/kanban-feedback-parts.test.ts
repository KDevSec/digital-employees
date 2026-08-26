// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConnectionBar from '../src/components/kanban/ConnectionBar.vue'
import EventFeedPanel from '../src/components/kanban/EventFeedPanel.vue'
import GatePauseBar from '../src/components/kanban/GatePauseBar.vue'
import type { GateRecord, TaskState } from '../src/stores/kanban'

/**
 * 看板反馈三件（L5 看板线 T7）：GatePauseBar（闸位停靠条——对话式放行引导 + 辅按钮）/
 * EventFeedPanel（评审流水：gate verdict / 人工 confirm / run 生命周期，最新在上）/
 * ConnectionBar（SSE 连接态）。错误常驻纪律：停靠/断线为常驻卡面元素非 toast。
 */

function task(partial: Partial<TaskState>): TaskState {
  return {
    taskId: 'R-1',
    title: 't',
    flow: 'demo-flow',
    displayName: '五阶段演示交付',
    workspace: 'D:/w',
    status: 'in_progress',
    currentNode: null,
    doneNodes: [],
    activeDispatches: [],
    gateRecords: [],
    blockedReason: null,
    durationS: null,
    lastSeq: 0,
    createdAt: '2026-08-27T02:00:00.000Z',
    updatedAt: '2026-08-27T02:00:00.000Z',
    ...partial,
  }
}

describe('GatePauseBar（闸位停靠条）', () => {
  it('非停靠态：不渲染（v-if 语义）', () => {
    const w = mount(GatePauseBar, { props: { task: task({ status: 'in_progress' }) } })
    expect(w.find('.gate-pause-bar').exists()).toBe(false)
  })

  it('停靠态：amber 类 + 对话式放行引导文案 + 通过/驳回辅按钮', () => {
    const w = mount(GatePauseBar, { props: { task: task({ status: 'gate_paused', currentNode: 'n0-req' }) } })
    const bar = w.find('.gate-pause-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.classes()).toContain('paused')
    expect(w.text()).toContain('批准')
    const buttons = w.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['通过', '驳回'])
  })

  it('辅按钮 emit：通过 → confirm / 驳回 → reject', async () => {
    const w = mount(GatePauseBar, { props: { task: task({ status: 'gate_paused' }) } })
    await w.findAll('button')[0].trigger('click')
    await w.findAll('button')[1].trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
    expect(w.emitted('reject')).toHaveLength(1)
  })
})

describe('EventFeedPanel（评审流水）', () => {
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

  it('gate 行：PASS 绿类 / FAIL 红类；verdict 与轮次、闸 id 可见', () => {
    const w = mount(EventFeedPanel, {
      props: {
        records: [rec({ verdict: 'PASS' }), rec({ verdict: 'FAIL', iter: 2, issues: ['X'] })],
      },
    })
    const rows = w.findAll('.feed-row')
    expect(rows[0].classes()).toContain('pass')
    expect(rows[1].classes()).toContain('fail')
    expect(w.text()).toContain('g-code-review')
    expect(w.text()).toContain('第2轮')
  })

  it('人工 confirm 行：human 类 + 「人工」标注（纪律④）', () => {
    const w = mount(EventFeedPanel, {
      props: { records: [rec({ kind: 'acceptance', verdict: 'approve', reviewer: 'human', actor: 'human' })] },
    })
    expect(w.find('.feed-row').classes()).toContain('human')
    expect(w.text()).toContain('人工')
  })

  it('run 生命周期行混排且最新在上（records + run 事件合并按 ts 降序）', () => {
    const w = mount(EventFeedPanel, {
      props: {
        records: [rec({ ts: '2026-08-27T02:00:03.000Z' })],
        feed: [
          { type: 'run.created', ts: '2026-08-27T02:00:00.000Z' },
          { type: 'run.completed', ts: '2026-08-27T02:00:09.000Z' },
        ] as never[],
      },
    })
    const rows = w.findAll('.feed-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('任务完成')
    expect(rows[2].text()).toContain('任务发起')
  })

  it('cap 50：超量只显示最新 50 条', () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      rec({ iter: i + 1, ts: `2026-08-27T02:00:${String(i).padStart(2, '0')}.000Z` }),
    )
    const w = mount(EventFeedPanel, { props: { records } })
    expect(w.findAll('.feed-row')).toHaveLength(50)
  })
})

describe('ConnectionBar（SSE 连接态）', () => {
  it.each([
    ['live', '实时连接', 'live'],
    ['reconnecting', '重连中', 'reconnecting'],
    ['connecting', '连接中', 'connecting'],
    ['closed', '已断开', 'closed'],
  ] as const)('%s → 文案 %s + 类 %s', (conn, text, cls) => {
    const w = mount(ConnectionBar, { props: { connection: conn } })
    expect(w.text()).toContain(text)
    expect(w.find('.conn-bar').classes()).toContain(cls)
  })
})
