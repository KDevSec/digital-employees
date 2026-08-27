// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { buildScenario } from '../src/fixtures/scenarios'
import EventWatchPanel from '../src/components/kanban/EventWatchPanel.vue'

/**
 * 事件观战（L5 v0.2，对齐 1.0 实时动作流的黑底观战卡；B4 裁决：数据源=六类事件）：
 * tail 式追加（最新在下自动滚底）、黑底等宽、行=时间+类型+摘要。
 * 真 stdout 观战留引擎线/V0.2（design §13.2）。
 */

const OPTS = { taskId: 'R-1', title: '支付网关对接', workspace: 'D:/w' }

const EMP = {
  'sec-compliance': '安全合规审核员',
  'req-clarifier': '需求澄清师',
  'reviewer-expert': '评审专家',
}

describe('EventWatchPanel（黑底事件观战）', () => {
  it('六类事件逐行渲染：时间 + 类型 tag + 中文摘要（员工中文名）', () => {
    const events = buildScenario('abort', OPTS)
    const w = mount(EventWatchPanel, { props: { feed: events, employees: EMP } })
    const lines = w.findAll('.watch-line')
    expect(lines).toHaveLength(7)
    expect(lines[0].text()).toContain('任务发起')
    expect(lines[0].text()).toContain('支付网关对接')
    expect(lines[1].text()).toContain('安全合规审核员')
    expect(lines[1].text()).toContain('派发')
    expect(lines[3].text()).toContain('n-adm → n0-req')
    expect(lines[6].text()).toContain('任务终止')
  })

  it('gate 行：闸 + verdict + 轮次（wtype=gate 过滤，不误中 transition）', () => {
    const events = buildScenario('happy-path', OPTS)
    const w = mount(EventWatchPanel, { props: { feed: events, employees: EMP } })
    const gateLines = w.findAll('.watch-line').filter((l) => l.find('.wtype').text() === 'gate')
    expect(gateLines.length).toBe(5)
    expect(gateLines[0].text()).toContain('PASS')
    expect(gateLines[0].text()).toContain('第1轮')
  })

  it('feed 增长自动滚底（watch nextTick scrollTop 贴底）', async () => {
    const events = buildScenario('happy-path', OPTS)
    const w = mount(EventWatchPanel, { props: { feed: events.slice(0, 3) } })
    const box = w.find('.watch-box').element as HTMLElement
    const spy = vi.fn()
    Object.defineProperty(box, 'scrollTo', { value: spy })
    await w.setProps({ feed: events.slice(0, 6) })
    await new Promise((r) => setTimeout(r, 0))
    expect(spy).toHaveBeenCalled()
  })

  it('空流：黑底框内「连接事件流…」占位', () => {
    const w = mount(EventWatchPanel, { props: { feed: [] } })
    expect(w.find('.watch-box').text()).toContain('连接事件流')
  })
})
