// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../src/api/engine-events'
import { demoFlowGatePauseTable, demoFlowTable } from '../src/fixtures/demo-flow.table'
import { buildScenario } from '../src/fixtures/scenarios'
import { applyEvent, emptyKanbanState, type TaskState } from '../src/stores/kanban'
import StageBand from '../src/components/kanban/StageBand.vue'

/**
 * 任务阶段横幅（L5 v0.2，对齐 1.0 stageband）：横向阶段步进格（表 stage 驱动零硬编码）+
 * gate 末格（通过闸数/总闸数，不给进度条——1.0 语义）；done 绿底 / active 呼吸光晕 /
 * gate_paused amber；每格 pct = 阶段内 done 节点 / 阶段节点总数。
 */

const OPTS = { taskId: 'R-1', title: 't', workspace: 'w' }

function replayTo(name: Parameters<typeof buildScenario>[0], uptoSeq: number): TaskState {
  let state = emptyKanbanState()
  for (const ev of buildScenario(name, OPTS).slice(0, uptoSeq)) state = applyEvent(state, ev)
  return state.tasks['R-1']
}

describe('StageBand（阶段步进横幅）', () => {
  it('五阶段格 + gate 末格（demo 表 stage 驱动，零硬编码）', () => {
    const w = mount(StageBand, { props: { table: demoFlowTable, task: replayTo('happy-path', 1) } })
    const stages = w.findAll('.sbstage').filter((s) => !s.classes().includes('sbgate'))
    expect(stages.map((s) => s.find('.snm').text())).toEqual(['准入', '需求核验', '设计核验', '开发实现', '准出'])
    expect(w.find('.sbgate').exists()).toBe(true)
  })

  it('推进中断言：准入 done（绿底），需求核验 active（呼吸类）+ pct 正确', () => {
    // 至 seq8：n-adm 段完成 + n0-req 完成（transition 已出）+ g-req-review 派发中
    // 节点完成 = transition 离开（dispatch done 不算）——需求核验 1/2
    const w = mount(StageBand, { props: { table: demoFlowTable, task: replayTo('happy-path', 8) } })
    const stages = w.findAll('.sbstage')
    const adm = stages[0]
    const req = stages[1]
    expect(adm.classes()).toContain('done')
    expect(req.classes()).toContain('active')
    expect(adm.find('.spct').text()).toBe('100%')
    expect(req.find('.spct').text()).toBe('50%')
  })

  it('gate 末格：通过闸数/总闸数（gateRecords 计数）；人工闸计入分母（变体表 6/6）', () => {
    // happy 全量：5 review 闸全过，demo 表无人工闸 → 5/5
    const w = mount(StageBand, { props: { table: demoFlowTable, task: replayTo('happy-path', 37) } })
    expect(w.find('.sbgate').text()).toContain('5/5')
    // gate-pause 全量：5 review PASS + 1 人工 approve；变体表 human_gate 节点计入分母 → 6/6
    const w2 = mount(StageBand, { props: { table: demoFlowGatePauseTable, task: replayTo('gate-pause', 40) } })
    expect(w2.find('.sbgate').text()).toContain('6/6')
  })

  it('gate_paused 任务：当前阶段格附 paused 类（amber 高亮）', () => {
    const w = mount(StageBand, { props: { table: demoFlowTable, task: replayTo('gate-pause', 4) } })
    const stages = w.findAll('.sbstage')
    expect(stages[1].classes()).toContain('paused')
    expect(stages[1].classes()).toContain('active')
  })

  it('表未到：骨架占位不炸', () => {
    const w = mount(StageBand, { props: { table: null, task: replayTo('happy-path', 1) } })
    expect(w.find('.sb-skeleton').exists()).toBe(true)
    expect(w.findAll('.sbstage')).toHaveLength(0)
  })
})
