/**
 * 引擎验收（T5）——E5 full 表兼容 / E6 表快照配置直驱 / fixture 产出（供 L5 看板先行）。
 * 验收锚：docs/plans/2026-08-26-l3-engine.md T5 段 8/9 与 §11 E5/E6。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type EngineDirs } from '../src/engine'

const ASSETS_FLOWS = fileURLToPath(new URL('../assets/flows', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

let root: string
let dirs: EngineDirs
let workspace: string
let engine: Engine

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'engine-acc-'))
  dirs = { dataDir: join(root, 'data'), templatesDir: ASSETS_FLOWS }
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  engine = new Engine(dirs)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('E5 · 1.0 full 表兼容（14 节点 / 8 gate / 2 decision 原样可跑）', () => {
  it('decision 分支 + review/acceptance 混合链全推进到 n13-done', () => {
    const tpl = join(root, 'tpl')
    mkdirSync(tpl)
    copyFileSync(join(HERE, 'fixtures', 'full-14.node-table.yml'), join(tpl, 'coding-flow.node-table.yml'))
    const e2 = new Engine({ dataDir: join(root, 'data2'), templatesDir: tpl })
    const { task_id } = e2.createTask({ mode: 'team', flow: 'coding-flow', workspace, title: '交付', input: 'x' })

    // n0-env → g-relevance(decision: high 直上 / low 绕 worktree)——两分支各验一次
    let v = e2.advance(task_id, 'n1-relevance')
    expect(v.current_node).toBe('n1-relevance')
    v = e2.recordGate(task_id, { gate: 'g-relevance', verdict: 'low', by: 'self' }) // decision 分支 low
    expect(v.current_node).toBe('n2-worktree')
    v = e2.advance(task_id, 'n5-complexity')
    v = e2.recordGate(task_id, { gate: 'g-complexity', verdict: 'complex', by: 'self' })
    expect(v.current_node).toBe('n6b-impl-subagent')
    e2.advance(task_id, 'n8-verify')
    v = e2.recordGate(task_id, { gate: 'g-verify', verdict: 'PASS', by: 'self' }) // review
    expect(v.current_node).toBe('n9a-code-review')
    v = e2.recordGate(task_id, { gate: 'g-code-review', verdict: 'PASS', by: 'reviewer-expert' })
    expect(v.current_node).toBe('n9b-e2e')
    v = e2.recordGate(task_id, { gate: 'g-e2e', verdict: 'PASS', by: 'self' }) // acceptance
    expect(v.current_node).toBe('n9c-increment')
    v = e2.recordGate(task_id, { gate: 'g-increment', verdict: 'done', by: 'self' }) // decision done → 收尾链
    expect(v.current_node).toBe('n10-sec')
    v = e2.recordGate(task_id, { gate: 'g-sec-review', verdict: 'PASS', by: 'reviewer-expert' })
    expect(v.current_node).toBe('n11-merge')
    v = e2.advance(task_id, 'n12-deploy')
    v = e2.recordGate(task_id, { gate: 'g-deploy', verdict: 'PASS', by: 'self' })
    expect(v.current_node).toBe('n13-done')
    expect(v.position).toMatchObject({ pct: 100 })

    // FAIL 回流也在 full 表形态验一条（g-verify FAIL → n6b）
    const { task_id: t2 } = e2.createTask({ mode: 'team', flow: 'coding-flow', workspace, title: 'T2', input: 'x' })
    e2.advance(t2, 'n1-relevance')
    e2.recordGate(t2, { gate: 'g-relevance', verdict: 'high', by: 'self' }) // high 分支
    e2.recordGate(t2, { gate: 'g-complexity', verdict: 'complex', by: 'self' })
    e2.advance(t2, 'n8-verify')
    const vf = e2.recordGate(t2, { gate: 'g-verify', verdict: 'FAIL', by: 'self' })
    expect(vf.current_node).toBe('n6b-impl-subagent')
  })
})

describe('E6 · 表快照配置直驱（改源表：在跑任务不受影响，新任务用新表）', () => {
  it('createTask 后改 templatesDir 源表 → 旧任务 getTable 不变、新任务加载新表', () => {
    // 独立模板目录（拷贝 demo 表——不污染 assets）
    const tpl = join(root, 'tpl')
    mkdirSync(tpl)
    copyFileSync(join(ASSETS_FLOWS, 'demo-flow.node-table.yml'), join(tpl, 'demo-flow.node-table.yml'))
    const e2 = new Engine({ dataDir: join(root, 'data2'), templatesDir: tpl })

    const a = e2.createTask({ mode: 'team', flow: 'demo-flow', workspace, title: 'A', input: 'x' })
    expect(e2.getTable(a.task_id).nodes).toHaveLength(12)

    // 改源表：在 n0-req 与 g-req-review 之间插入观察节点（行级重写，保持 YAML 结构）
    const raw = readFileSync(join(tpl, 'demo-flow.node-table.yml'), 'utf8')
    const lines = raw.split('\n')
    const out: string[] = []
    for (const line of lines) {
      if (line.includes('id: n0-req')) out.push(line.replace('next: [g-req-review]', 'next: [n-obs]'))
      else if (line.includes('id: g-req-review')) {
        out.push('  - {id: n-obs, name: 观察, kind: action, next: [g-req-review]}')
        out.push(line)
      } else out.push(line)
    }
    writeFileSync(join(tpl, 'demo-flow.node-table.yml'), out.join('\n'))

    // 旧任务：快照不变（12 节点 + n0-req.next 旧值）
    expect(e2.getTable(a.task_id).nodes).toHaveLength(12)
    expect(e2.getTable(a.task_id).nodes.find((n) => n.id === 'n0-req')!.next).toEqual(['g-req-review'])

    // 新任务：新表（13 节点）
    const b = e2.createTask({ mode: 'team', flow: 'demo-flow', workspace, title: 'B', input: 'x' })
    expect(e2.getTable(b.task_id).nodes).toHaveLength(13)
    e2.advance(b.task_id, 'n0-req')
    e2.advance(b.task_id, 'n-obs') // 新节点可达（n0-req → n-obs → g-req-review）
  })
})

describe('fixture 产出（供 L5 看板 fixture 先行开发）', () => {
  it('demo 表五阶段全链真实推进 → events.jsonl 落 fixtures/demo-run-events.jsonl（行数 ≥ 20）', () => {
    const { task_id } = engine.createTask({
      mode: 'team', flow: 'demo-flow', workspace, title: '登录页交付', input: '做一个登录页',
    })

    // 模拟驱动器+员工回报全链（各段 dispatchStart→advance→…→dispatchDone；闸位 recordGate）
    const run = (emp: string, fromAdv: string[], gates: Array<[string, 'PASS' | 'FAIL']> = []) => {
      const d = engine.dispatchStart(task_id, { emp })
      for (const to of fromAdv) engine.advance(task_id, to)
      for (const [g, verdict] of gates) engine.recordGate(task_id, { gate: g, verdict, by: 'reviewer' })
      engine.dispatchDone(task_id, { emp, dispatch_id: d.dispatch_id, usage: { tokens: 1000 } })
    }

    run('sec-compliance', ['n0-req'])
    run('req-clarifier', ['g-req-review'], [['g-req-review', 'PASS']])
    run('sys-engineer', ['g-design-review'], [['g-design-review', 'PASS'], ['g-sec-design', 'PASS']])
    run('dev-engineer', ['g-code-review'], [['g-code-review', 'PASS'], ['g-sec-code', 'FAIL']]) // 注入一次 FAIL：reflow 演示
    run('dev-engineer', ['g-code-review'], [['g-code-review', 'PASS'], ['g-sec-code', 'PASS']])
    run('sec-compliance', ['n-done']) // g-sec-code PASS 已推进到 n3-sec，本段只收尾

    // 表快照在归档前取（completeTask 后活动目录移走）
    engine.completeTask(task_id, 'completed')

    const events = engine.readEvents(task_id)
    expect(events.length).toBeGreaterThanOrEqual(20)

    // 事件完整性断言（U8 机检的引擎级形态）
    expect(events[0].type).toBe('run.created')
    expect(events.at(-1)!.type).toBe('run.completed')
    // 回流信号口径：R3 的 FAIL 回流 transition 不带 reflow:true（两套溢出语义——reflow 标志属 R2 机械路径），
    // 看板判回流用 gate 事件 verdict=FAIL（闸 FAIL 即回流，走 on_reflow 出边）
    const reflow = events.filter((e) => e.type === 'gate' && e.verdict === 'FAIL')
    expect(reflow).toHaveLength(1) // g-sec-code FAIL 一次
    expect(events.filter((e) => e.type === 'dispatch' && e.phase === 'start')).toHaveLength(6)
    expect(events.filter((e) => e.type === 'dispatch' && e.phase === 'done')).toHaveLength(6)
    expect(events.filter((e) => e.type === 'gate')).toHaveLength(7)

    // 落 fixture（L5 消费真源——提交进仓）。源取归档侧（completeTask 已把工作区账本搬 archive）
    const src = join(dirs.dataDir, 'archive', 'tasks', task_id, 'events.jsonl')
    expect(existsSync(src)).toBe(true)
    copyFileSync(src, join(HERE, 'fixtures', 'demo-run-events.jsonl'))
    expect(readFileSync(join(HERE, 'fixtures', 'demo-run-events.jsonl'), 'utf8').trim().split('\n'))
      .toHaveLength(events.length)
  })
})
