// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AlertPanel from '../src/components/kanban/AlertPanel.vue'
import type { TaskState } from '../src/stores/kanban'

/**
 * 告警卡（L5 v0.2，对齐 1.0 监督员告警卡位）：闸位停靠置顶（含通过/驳回辅按钮——
 * D-kb05 保留）+ blocked/aborted 常驻（纪律⑥）；无告警整卡不渲染。
 */

function task(p: Partial<TaskState>): TaskState {
  return {
    taskId: 'R-1',
    title: 't',
    flow: 'demo-flow',
    displayName: '',
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
    ...p,
  }
}

describe('AlertPanel（告警卡）', () => {
  it('无告警：整卡不渲染', () => {
    const w = mount(AlertPanel, { props: { task: task({}) } })
    expect(w.find('.alert-panel').exists()).toBe(false)
  })

  it('闸位停靠：置顶 amber 告警 + 引导文案 + 通过/驳回按钮 → emit', async () => {
    const w = mount(AlertPanel, {
      props: { task: task({ status: 'gate_paused', currentNode: 'n0-req' }) },
    })
    const rows = w.findAll('.alert-row')
    expect(rows[0].classes()).toContain('paused')
    expect(rows[0].text()).toContain('批准')
    const btns = rows[0].findAll('button')
    expect(btns.map((b) => b.text())).toEqual(['通过', '驳回'])
    await btns[0].trigger('click')
    await rows[0].findAll('button')[1].trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
    expect(w.emitted('reject')).toHaveLength(1)
  })

  it('blocked：红告警 + 原因常驻（非 toast）', () => {
    const w = mount(AlertPanel, {
      props: { task: task({ status: 'blocked', blockedReason: 'spawn 失败：底座 CLI 不可用' }) },
    })
    const row = w.find('.alert-row')
    expect(row.classes()).toContain('blocked')
    expect(row.text()).toContain('spawn 失败')
  })

  it('aborted：终止告警 + 原因', () => {
    const w = mount(AlertPanel, {
      props: { task: task({ status: 'aborted', blockedReason: '评审超时' }) },
    })
    expect(w.find('.alert-row').classes()).toContain('aborted')
    expect(w.find('.alert-row').text()).toContain('评审超时')
  })

  it('停靠 + 阻塞并存：停靠行在前（置顶优先级）', () => {
    const w = mount(AlertPanel, {
      props: { task: task({ status: 'gate_paused', currentNode: 'g-x', blockedReason: '此前派发失败' }) },
    })
    const rows = w.findAll('.alert-row')
    expect(rows[0].classes()).toContain('paused')
    expect(rows[1].classes()).toContain('blocked')
  })
})
