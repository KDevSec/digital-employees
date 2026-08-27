/**
 * 引擎门面（T5）——11 操作 API 面集成测试。
 * 消费链：schema（T1）×R2（T2）×R3（T3）×R1（T4）×本门面。
 * 契约锚：docs/plans/2026-08-26-l3-engine.md「全局类型契约」Engine 段 + 设计 §9。
 * 纪律 P-11：每用例独立临时夹具（dataDir/templatesDir/workspace），测毕清理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineError, renderPrompt, type EngineDirs } from '../src/engine'
import type { EngineEvent } from '../src/schema/events'

const ASSETS_FLOWS = fileURLToPath(new URL('../assets/flows', import.meta.url))

let root: string
let dirs: EngineDirs
let workspace: string
let engine: Engine

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engine-'))
  dirs = { dataDir: join(root, 'data'), templatesDir: ASSETS_FLOWS }
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  engine = new Engine(dirs)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const createDemo = () => engine.createTask({
  mode: 'team', flow: 'demo-flow', workspace, title: '登录页交付', input: '做一个登录页',
})

describe('Engine · 全操作往返（demo 表快乐路径）', () => {
  it('createTask → run.created 事件 → nextStep 渲染 → dispatch/advance/handoff/dispatchDone → recordGate PASS', () => {
    const { task_id } = createDemo()

    // run.created 首事件（actor=human）
    const created = engine.readEvents(task_id)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      type: 'run.created', trace_id: task_id, actor: 'human', flow: 'demo-flow',
      title: '登录页交付', workspace, display_name: '五阶段演示交付',
    })

    // nextStep：首节点 n-adm（action）——emp/prompt 渲染
    const ns = engine.nextStep(task_id)
    expect(ns.current_node).toBe('n-adm')
    expect(ns.node_kind).toBe('action')
    expect(ns.emp).toBe('sec-compliance')
    expect(ns.prompt).toContain('secretgate')
    expect(ns.next_actions).toEqual([{ to_node: 'n0-req', label: '需求核验' }])

    // 段一：准入（模拟 sec-compliance 回报）
    const d1 = engine.dispatchStart(task_id, { emp: 'sec-compliance', node: 'n-adm' })
    expect(d1.dispatch_id).toBe('d-1')
    let v = engine.advance(task_id, 'n0-req')
    expect(v.current_node).toBe('n0-req')
    expect(v.position).toEqual({ cleared: 0, total: 6, pct: 0 })

    // handoff 落盘（文件真源）
    const h = engine.handoffWrite(task_id, {
      emp: 'sec-compliance', node: 'n-adm', summary: '输入扫描通过，无泄露',
      artifacts: ['scan-report.json'],
    })
    expect(existsSync(h.path)).toBe(true)
    const hd = JSON.parse(readFileSync(h.path, 'utf8'))
    expect(hd).toMatchObject({ node_id: 'n-adm', employee: 'sec-compliance', status: 'done', summary: '输入扫描通过，无泄露', artifacts: ['scan-report.json'] })

    engine.dispatchDone(task_id, { emp: 'sec-compliance', dispatch_id: 'd-1', usage: { tokens: 1200 } })

    // 段二：需求（req-clarifier）→ 评审闸 PASS
    const d2 = engine.dispatchStart(task_id, { emp: 'req-clarifier', node: 'n0-req' })
    expect(d2.dispatch_id).toBe('d-2')
    v = engine.advance(task_id, 'g-req-review')
    expect(v.current_node).toBe('g-req-review')
    v = engine.recordGate(task_id, { gate: 'g-req-review', verdict: 'PASS', by: 'reviewer-expert', issues: [] })
    expect(v.current_node).toBe('n1-design')
    expect(v.gate_iters['g-req-review']).toBe(0)
    engine.dispatchDone(task_id, { emp: 'req-clarifier', dispatch_id: 'd-2' })

    // 事件序与因果链：d-2 start 的 parent = d-1 done
    const events = engine.readEvents(task_id)
    const d2Start = events.find((e) => e.type === 'dispatch' && e.dispatch_id === 'd-2' && e.phase === 'start')!
    const d1Done = events.find((e) => e.type === 'dispatch' && e.dispatch_id === 'd-1' && e.phase === 'done')!
    expect(d2Start.parent_seq).toBe(d1Done.seq)

    // gate 事件载荷（reviewer=by 员工 id）
    const gateEv = events.find((e) => e.type === 'gate')!
    expect(gateEv).toMatchObject({
      gate: 'g-req-review', verdict: 'PASS', reviewer: 'reviewer-expert',
      kind: 'review', node: 'g-req-review', actor: 'reviewer-expert',
    })

    // transition 事件带 status 快照
    const trans = events.filter((e) => e.type === 'transition')
    expect(trans.length).toBeGreaterThanOrEqual(3)
    expect(trans.every((e) => typeof e.status === 'string')).toBe(true)

    // dispatch done 带 usage
    expect(d1Done.usage).toEqual({ tokens: 1200 })
  })

  it('completeTask：completed 事件（duration_s）+ 归档（活动目录消失、事件可读、getTask 归档兜底）', () => {
    const { task_id } = createDemo()
    engine.advance(task_id, 'n0-req')
    const v = engine.completeTask(task_id, 'completed')
    expect(v.status).toBe('completed')
    expect(v.current_node).toBe('n0-req')

    const events = engine.readEvents(task_id)
    const done = events[events.length - 1]
    expect(done.type).toBe('run.completed')
    expect(done.final_node).toBe('n0-req')
    expect(typeof done.duration_s).toBe('number')

    // 归档侧兜底可读
    expect(engine.readEvents(task_id).length).toBe(events.length)
    expect(engine.getTask(task_id).status).toBe('completed')
    // 二次 complete 拒绝
    expect(() => engine.completeTask(task_id)).toThrow(EngineError)
  })
})

describe('Engine · E3/E4 闸与溢出双语义', () => {
  it('recordGate FAIL → on_reflow 回流 + transition(reflow:true)', () => {
    const { task_id } = createDemo()
    engine.advance(task_id, 'n0-req')
    engine.advance(task_id, 'g-req-review')
    const v = engine.recordGate(task_id, { gate: 'g-req-review', verdict: 'FAIL', by: 'reviewer-expert', issues: ['需求模糊'] })
    expect(v.current_node).toBe('n0-req')
    expect(v.gate_iters['g-req-review']).toBe(1)
    const ev = engine.readEvents(task_id).find((e) => e.type === 'gate')!
    expect(ev.verdict).toBe('FAIL')
    expect(ev.issues).toEqual(['需求模糊'])
    const trans = engine.readEvents(task_id).filter((e) => e.type === 'transition').at(-1)!
    // R3 的 FAIL 回流走 advance(reflow:false)——两套溢出语义（R3 自持 gate_iters）；回流信号=from 是 gate 节点
    expect(trans).toMatchObject({ reflow: false, from: 'g-req-review', to: 'n0-req' })
  })

  it('R3 gate_iters 溢出 → blocked（escalate 不推进）；R2 机械 reflow 溢出 → terminal_fail + forced_fail', () => {
    // 代码内小表：cap=1（FAIL 一次即 escalate）
    const tpl = join(root, 'tpl'); mkdirSync(tpl)
    writeFileSync(join(tpl, 'tiny.node-table.yml'), [
      'flow: tiny', 'max_retries: 1', 'terminal_fail: n-fail', 'delivery_node: n-done', 'nodes:',
      '  - {id: a, name: A, kind: action, next: [g]}',
      '  - {id: g, name: G, kind: gate, gate: g1, next: [n-done, a]}',
      '  - {id: n-done, name: D, kind: terminal, next: []}',
      '  - {id: n-fail, name: F, kind: terminal, next: []}',
      'gate_specs:',
      '  g1: {kind: review, reviewer: rv, on_pass: n-done, on_reflow: a}',
    ].join('\n'))
    const e2 = new Engine({ dataDir: join(root, 'data2'), templatesDir: tpl })
    const { task_id } = e2.createTask({ mode: 'team', flow: 'tiny', workspace, title: 't', input: 'x' })

    e2.advance(task_id, 'g')
    const blocked = e2.recordGate(task_id, { gate: 'g1', verdict: 'FAIL', by: 'rv' })
    expect(blocked.status).toBe('blocked')
    expect(blocked.current_node).toBe('g') // 原地不推进不 force-accept
    expect(blocked.blocked_reason).toContain('escalate to human')

    // R2 机械 reflow：同表 reset 场景——新任务，走 advance reflow 溢出
    const { task_id: t2 } = e2.createTask({ mode: 'team', flow: 'tiny', workspace, title: 't2', input: 'x' })
    e2.advance(t2, 'g')
    e2.recordGate(t2, { gate: 'g1', verdict: 'FAIL', by: 'rv' }) // iters=1=cap → blocked？——cap=1 第一次 FAIL 即 blocked
    // R2 路径独立测：直接 advance(a, reflow)——先造 retries 前置
    const { task_id: t3 } = e2.createTask({ mode: 'team', flow: 'tiny', workspace, title: 't3', input: 'x' })
    e2.advance(t3, 'g')
    e2.recordGate(t3, { gate: 'g1', verdict: 'PASS', by: 'rv' }) // 回 n-done？on_pass=n-done → 完成
    // R2：g→a reflow 一次（iters 语义独立）：直接用 advance reflow
    const { task_id: t4 } = e2.createTask({ mode: 'team', flow: 'tiny', workspace, title: 't4', input: 'x' })
    e2.advance(t4, 'g')
    const v1 = e2.advance(t4, 'a', { reflow: true }) // retries[a]=1 ≤ cap=1
    expect(v1.current_node).toBe('a')
    e2.advance(t4, 'g')
    const v2 = e2.advance(t4, 'a', { reflow: true }) // retries[a]=2 > cap → forced terminal_fail
    expect(v2.current_node).toBe('n-fail')
    const trans = e2.readEvents(t4).filter((e) => e.type === 'transition').at(-1)!
    expect(trans).toMatchObject({ reflow: true, forced_fail: true, to: 'n-fail' })
  })
})

describe('Engine · 人工闸 gate_paused / confirmGate 对话式放行', () => {
  it('advance 落 human_gate 节点 → gate_paused；approve → 人工 gate 事件 + advance；reject → FAIL 事件 + 原地恢复', () => {
    const tpl = join(root, 'tpl2'); mkdirSync(tpl)
    writeFileSync(join(tpl, 'hg.node-table.yml'), [
      'flow: hg', 'max_retries: 3', 'terminal_fail: n-fail', 'delivery_node: n-done', 'nodes:',
      '  - {id: a, name: A, kind: action, next: [h]}',
      '  - {id: h, name: 人工确认, kind: action, human_gate: true, next: [n-done]}',
      '  - {id: n-done, name: D, kind: terminal, next: []}',
      '  - {id: n-fail, name: F, kind: terminal, next: []}',
      'gate_specs: {}',
    ].join('\n'))
    const e2 = new Engine({ dataDir: join(root, 'data3'), templatesDir: tpl })
    const { task_id } = e2.createTask({ mode: 'team', flow: 'hg', workspace, title: 't', input: 'x' })

    e2.advance(task_id, 'h')
    let v = e2.getTask(task_id)
    expect(v.status).toBe('gate_paused') // advance 自动停靠
    expect(e2.nextStep(task_id).next_actions).toEqual([]) // 停靠无动作

    // 非停靠状态拒绝 confirm
    expect(() => e2.confirmGate(task_id, { node: 'a', verdict: 'approve' })).toThrow(EngineError)

    // approve：人工 gate 事件（PASS by=human）+ transition
    v = e2.confirmGate(task_id, { node: 'h', verdict: 'approve', note: '准出通过' })
    expect(v.current_node).toBe('n-done')
    expect(v.status).toBe('in_progress')
    const events = e2.readEvents(task_id)
    const humanGate = events.find((e) => e.type === 'gate')!
    expect(humanGate).toMatchObject({
      gate: 'human:h', verdict: 'PASS', reviewer: 'human', actor: 'human', request_id: 'confirm:h',
    })
    expect(events.filter((e) => e.type === 'transition').at(-1)).toMatchObject({ from: 'h', to: 'n-done' })

    // reject 场景：新任务
    const { task_id: t2 } = e2.createTask({ mode: 'team', flow: 'hg', workspace, title: 't2', input: 'x' })
    e2.advance(t2, 'h')
    const v2 = e2.confirmGate(t2, { node: 'h', verdict: 'reject', note: '返工' })
    expect(v2.current_node).toBe('h') // 原地
    expect(v2.status).toBe('in_progress') // 恢复可操作
    const g2 = e2.readEvents(t2).find((e) => e.type === 'gate')!
    expect(g2.verdict).toBe('FAIL') // 人工评审也进流水（消费契约④）
  })
})

describe('Engine · emitter 与 solo 模式', () => {
  it('onEvent：按落盘序（seq 序）分发全部事件；退订后不再收', () => {
    const received: EngineEvent[] = []
    const off = engine.onEvent((e) => received.push(e))
    const { task_id } = createDemo()
    engine.advance(task_id, 'n0-req')
    engine.dispatchStart(task_id, { emp: 'req-clarifier' })

    const seqs = received.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b)) // 有序
    expect(received.map((e) => e.type)).toEqual(['run.created', 'transition', 'dispatch'])
    expect(received.every((e) => e.trace_id === task_id)).toBe(true)

    off()
    engine.advance(task_id, 'g-req-review')
    expect(received).toHaveLength(3) // 退订后不收
  })

  it('solo 模式：动态单节点表（emp=选定员工，prompt={{input}} 渲染）→ 全链推进完成', () => {
    const { task_id } = engine.createTask({
      mode: 'solo', employee: 'dev-engineer', workspace, title: '小改动', input: '改个按钮文案',
    })
    const ns = engine.nextStep(task_id)
    expect(ns.current_node).toBe('n-exec')
    expect(ns.emp).toBe('dev-engineer')
    expect(ns.prompt).toBe('改个按钮文案') // {{input}} 渲染

    const table = engine.getTable(task_id)
    expect(table.flow).toBe('solo:dev-engineer')
    expect(table.nodes).toHaveLength(3)

    engine.dispatchStart(task_id, { emp: 'dev-engineer' })
    engine.advance(task_id, 'n-done')
    const v = engine.completeTask(task_id)
    expect(v.status).toBe('completed')
    expect(v.position).toEqual({ cleared: 1, total: 1, pct: 100 }) // 0 gate+终点：终点位 cleared=total
  })

  it('错误契约：未知 flow 模板 → EngineError 含路径；solo 缺 employee → EngineError', () => {
    expect(() => engine.createTask({ mode: 'team', flow: 'nope', workspace, title: 't', input: 'x' }))
      .toThrow(/flow 模板不存在/)
    expect(() => engine.createTask({ mode: 'solo', workspace, title: 't', input: 'x' }))
      .toThrow(/solo 模式必须提供 employee/)
  })
})

describe('Engine · renderPrompt 变量插值', () => {
  it('{{input}}/{{run.workspace}}/{{run.title}} 三变量替换', () => {
    const meta = {
      task_id: 't-x', flow: 'f', title: '标题', workspace: 'D:/w', input: '需求文本',
      created_at: '', updated_at: '',
    }
    expect(renderPrompt('解析 {{input}}，产物写 {{run.workspace}}，任务名 {{run.title}}', meta))
      .toBe('解析 需求文本，产物写 D:/w，任务名 标题')
  })
})
