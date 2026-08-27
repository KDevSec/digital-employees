/**
 * 驱动器 + spawn runner（L3 T9）——β-lite L1 全自动形态（mock launcher）。
 * 验收锚：U3/U4/U5 的进程内形态（真机 spawn 归 I2）+ M3 崩溃恢复的无状态续推。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '@devzero/engine'
import { MockLauncher } from '../src/engine/launcher'
import { SpawnRunner, reviewPromptBody } from '../src/engine/spawn-runner'
import { Driver } from '../src/engine/driver'

const ENGINE_ASSETS = fileURLToPath(new URL('../../workbench-engine/assets/flows', import.meta.url))

let root: string
let engine: Engine
let workspace: string
let mock: MockLauncher

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'driver-'))
  const flows = join(root, 'flows')
  mkdirSync(flows, { recursive: true })
  copyFileSync(join(ENGINE_ASSETS, 'demo-flow.node-table.yml'), join(flows, 'demo-flow.node-table.yml'))
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flows })
  mock = new MockLauncher(engine)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** demo 表五阶段全员的 mock 指令表（emp@node → 行为）；FAIL 注入点由用例覆盖 */
const happyDirectives = (emp: string, node: string): string[] => {
  const table: Record<string, string[]> = {
    'sec-compliance@n-adm': ['advance:n0-req', 'dispatch_done'],
    'req-clarifier@n0-req': ['advance:g-req-review', 'dispatch_done'],
    'reviewer-expert@g-req-review': ['gate:PASS', 'dispatch_done'],
    'sys-engineer@n1-design': ['advance:g-design-review', 'handoff:n1-design:设计完成', 'dispatch_done'],
    'reviewer-expert@g-design-review': ['gate:PASS', 'dispatch_done'],
    'sec-design@g-sec-design': ['gate:PASS', 'dispatch_done'],
    'dev-engineer@n2-impl': ['advance:g-code-review', 'dispatch_done'],
    'reviewer-expert@g-code-review': ['gate:PASS', 'dispatch_done'],
    'sec-code@g-sec-code': ['gate:PASS', 'dispatch_done'],
    'sec-compliance@n3-sec': ['advance:n-done', 'dispatch_done'],
  }
  return table[`${emp}@${node}`] ?? []
}

const buildDriver = (directivesFor = happyDirectives) => {
  const runner = new SpawnRunner({ launcher: mock, spawnDir: () => join(root, 'spawn') })
  const driver = new Driver(engine, runner, { mockDirectivesFor: directivesFor })
  driver.start()
  return driver
}

/** 等事件循环收敛（mock 指令链全异步推进到无新事件） */
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

describe('Driver · demo 五阶段全自动快乐路径（U3 进程内）', () => {
  it('run.created → 段段派发 → 五闸全过 → n-done → completeTask 归档；派发序与 prompt 断言', async () => {
    const driver = buildDriver()
    const { task_id } = engine.createTask({
      mode: 'team', flow: 'demo-flow', workspace, title: '登录页交付', input: '做一个登录页',
    })
    await settle()

    const final = engine.getTask(task_id)
    expect(final.status).toBe('completed')
    expect(final.current_node).toBe('n-done')

    // 派发序（dispatchLog）：三员工+四评审+准入准出 = 10 次派发
    expect(driver.dispatchLog.map((d) => `${d.emp}@${d.node}`)).toEqual([
      'sec-compliance@n-adm', 'req-clarifier@n0-req', 'reviewer-expert@g-req-review',
      'sys-engineer@n1-design', 'reviewer-expert@g-design-review', 'sec-design@g-sec-design',
      'dev-engineer@n2-impl', 'reviewer-expert@g-code-review', 'sec-code@g-sec-code',
      'sec-compliance@n3-sec',
    ])

    // prompt 断言：员工 prompt=渲染后节点指令（{{input}} 已注入）；评审 prompt=评审模板（含 handoffs 路径）
    const firstPrompt = readFileSync(mock.requests[0].promptFile, 'utf8')
    expect(firstPrompt).toContain('task_id: ' + task_id)
    expect(firstPrompt).toContain('secretgate')
    const reviewPrompt = readFileSync(mock.requests[2].promptFile, 'utf8')
    expect(reviewPrompt).toContain('reviewer-expert')
    expect(reviewPrompt).toContain(`.devzero/tasks/${task_id}/handoffs/`)

    // 事件流完整：6 dispatch start/done 配对 + 5 gate PASS + run.created/completed
    const events = engine.readEvents(task_id)
    expect(events.filter((e) => e.type === 'dispatch' && e.phase === 'start')).toHaveLength(10)
    expect(events.filter((e) => e.type === 'dispatch' && e.phase === 'done')).toHaveLength(10)
    expect(events.filter((e) => e.type === 'gate' && e.verdict === 'PASS')).toHaveLength(5)
    expect(events.at(-1)!.type).toBe('run.completed')
  })
})

describe('Driver · FAIL 回流重派（U3 注入）', () => {
  it('g-sec-code 首评 FAIL → 回流 n2-impl → dev-engineer 二次派发修复 → 再评 PASS → 继续到收尾', async () => {
    let secCodeVisits = 0
    buildDriver((emp, node) => {
      if (emp === 'sec-code' && node === 'g-sec-code') {
        secCodeVisits++
        return [secCodeVisits === 1 ? 'gate:FAIL' : 'gate:PASS', 'dispatch_done']
      }
      return happyDirectives(emp, node)
    })
    const { task_id } = engine.createTask({ mode: 'team', flow: 'demo-flow', workspace, title: 'T', input: 'x' })
    await settle()

    expect(engine.getTask(task_id).status).toBe('completed')
    // dev-engineer 修复段二次派发：n2-impl 出现两次
    const implDispatches = engine.readEvents(task_id).filter(
      (e) => e.type === 'dispatch' && e.phase === 'start' && e.node === 'n2-impl',
    )
    expect(implDispatches).toHaveLength(2)
    const failGate = engine.readEvents(task_id).find((e) => e.type === 'gate' && e.verdict === 'FAIL')
    expect(failGate?.gate).toBe('g-sec-code')
  })
})

describe('Driver · 人工闸停靠与放行（U4）', () => {
  it('hg 表：advance 落 human_gate → 驱动器不 spawn（停靠）；confirmGate(approve) → 续派收尾', async () => {
    const flows = join(root, 'flows')
    const hg = [
      'flow: hg', 'max_retries: 3', 'terminal_fail: n-fail', 'delivery_node: n-done', 'nodes:',
      '  - {id: a, name: A, kind: action, emp: dev-engineer, next: [h]}',
      '  - {id: h, name: 人工确认, kind: action, emp: dev-engineer, human_gate: true, next: [n-done]}',
      '  - {id: n-done, name: D, kind: terminal, next: []}',
      '  - {id: n-fail, name: F, kind: terminal, next: []}',
      'gate_specs: {}',
    ].join('\n')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(flows, 'hg.node-table.yml'), hg)

    let spawns = 0
    const trackingMock = new MockLauncher(engine, { hook: () => { spawns++ } })
    const runner = new SpawnRunner({ launcher: trackingMock, spawnDir: () => join(root, 'spawn') })
    const driver = new Driver(engine, runner, {
      mockDirectivesFor: (emp, node) =>
        node === 'a' ? ['advance:h', 'dispatch_done'] : node === 'n-done' ? ['dispatch_done'] : [],
    })
    driver.start()

    const { task_id } = engine.createTask({ mode: 'team', flow: 'hg', workspace, title: 'T', input: 'x' })
    await settle()

    // 停靠：a 段 spawn 1 次，h 停靠不 spawn
    expect(engine.getTask(task_id).status).toBe('gate_paused')
    expect(spawns).toBe(1)

    // 对话式放行（人/human 通道——测试直调）→ 驱动器续派 h 段？——h 的 next=n-done（terminal）：
    // approve 后 advance 到 n-done（terminal）→ 驱动器收 human gate PASS → advanceLoop → completeTask
    engine.confirmGate(task_id, { node: 'h', verdict: 'approve', note: '通过' })
    await settle()
    expect(engine.getTask(task_id).status).toBe('completed')
    expect(spawns).toBe(1) // terminal 不派——收尾不 spawn
  })
})

describe('Driver · spawn 失败挂起与重启续推（U5 + M3 崩溃恢复语义）', () => {
  it('mock fail 指令 → 重试 1 次 → 挂起（suspendedTasks 有因）；stop→新 Driver（无状态重启）→ 重新派发成功走完', async () => {
    let failedOnce = false
    const flakyDirectives = (emp: string, node: string): string[] => {
      if (node === 'n0-req' && !failedOnce) {
        failedOnce = true
        return ['fail'] // 首次派发失败
      }
      return happyDirectives(emp, node)
    }
    const driver = buildDriver(flakyDirectives)
    const { task_id } = engine.createTask({ mode: 'team', flow: 'demo-flow', workspace, title: 'T', input: 'x' })
    await settle()

    // 首段 spawn fail×2（初次+重试）→ 挂起；任务状态保持 in_progress（引擎不 blocked——D-050 语义）
    expect(driver.suspendedTasks().get(task_id)?.reason).toContain('spawn 失败')
    expect(engine.getTask(task_id).status).toBe('in_progress')
    const dispatchesAtSuspend = mock.requests.length
    expect(dispatchesAtSuspend).toBe(3) // n-adm 成功 + n0-req 初次 + 重试

    // 无状态重启：stop 挂起驱动器 → 新驱动器（挂起表清零）→ 人为触发续推（新 run.created 等价物：
    // 实际由 L0 手动 advance/confirm 或重启后事件触发——测试用 dispatchDone 人工补发段完成模拟恢复）
    driver.stop()
    const driver2 = buildDriver(happyDirectives)
    // 恢复触发：当前停在 n0-req（上段 done 已发过）——L0 人先手动派（dispatchStart+spawn 由人/mock 完成段）：
    // 这里模拟「重启后驱动器从当前状态续推」——通过一个人工 dispatch_done 等价事件驱动 advanceLoop
    const d = engine.dispatchStart(task_id, { emp: 'req-clarifier', node: 'n0-req' })
    engine.dispatchDone(task_id, { emp: 'req-clarifier', dispatch_id: d.dispatch_id })
    await settle()

    expect(engine.getTask(task_id).status).toBe('completed')
    expect(driver2.dispatchLog.length).toBeGreaterThan(0)
  })

  it('stop() 后不再消费事件（幂等停机）', async () => {
    const driver = buildDriver()
    const { task_id } = engine.createTask({ mode: 'team', flow: 'demo-flow', workspace, title: 'T', input: 'x' })
    await settle()
    driver.stop()
    const before = mock.requests.length
    // stop 后人为事件（模拟底座迟回报）——不触发新派发（任务已归档时 write 被拒属预期，吞掉只验驱动器静默）
    try { engine.dispatchDone(task_id, { emp: 'ghost', dispatch_id: 'd-99' }) } catch { /* archived 预期 */ }
    await settle()
    expect(mock.requests.length).toBe(before)
  })
})

describe('SpawnRunner · 指令文件与超时', () => {
  it('prompt 落文件（上下文标记+正文+#mock 区）；permission bypass 标注', async () => {
    const runner = new SpawnRunner({ launcher: mock, spawnDir: () => join(root, 'spawn') })
    const spec = {
      taskId: 't-x', workspace, emp: 'dev-engineer', node: 'n2-impl',
      promptBody: '按设计实现', dispatchId: 'd-3',
      mockDirectives: ['exit:0'], // 纯文件落盘断言——不用会触发引擎调用的指令（t-x 非真任务）
    }
    await runner.spawn(spec)
    const prompt = readFileSync(mock.requests[0].promptFile, 'utf8')
    expect(prompt).toContain('task_id: t-x')
    expect(prompt).toContain('node: n2-impl')
    expect(prompt).toContain('dispatch_id: d-3')
    expect(prompt).toContain('按设计实现')
    expect(prompt).toContain('#mock:exit:0')
    expect(mock.requests[0].permission).toBe('bypass')
    expect(mock.requests[0].workdir).toBe(workspace)
  })

  it('超时：sleep 指令超过 timeoutMs → reject 含定位', async () => {
    const runner = new SpawnRunner({ launcher: mock, spawnDir: () => join(root, 'spawn'), timeoutMs: 50 })
    await expect(runner.spawn({
      taskId: 't-x', workspace, emp: 'dev-engineer', node: 'a',
      promptBody: '慢会话', dispatchId: 'd-1', mockDirectives: ['sleep:5000'],
    })).rejects.toThrow(/spawn 超时/)
  })

  it('🟡2 spawn 前键级自愈：.mcp.json 被用户改写丢键 → 派发后补回且用户键保留', async () => {
    const { task_id } = engine.createTask({ mode: 'solo', employee: 'dev-engineer', workspace, title: 'T', input: 'x' })
    // 用户中途用底座 CLI 重写配置（我们的键没了，用户键在）
    const { writeFileSync: wf } = await import('node:fs')
    wf(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { userTool: { type: 'stdio', command: 'x' } } }))
    const runner = new SpawnRunner({ launcher: mock, spawnDir: () => join(root, 'spawn') })
    await runner.spawn({
      taskId: task_id, workspace, emp: 'dev-engineer', node: 'n-exec',
      promptBody: 'x', dispatchId: 'd-9', mockDirectives: ['exit:0'],
    })
    const doc = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(doc.mcpServers.userTool).toBeDefined()
    expect(doc.mcpServers['devzero-engine']).toBeDefined()
  })

  it('reviewPromptBody 模板含 handoffs 路径与覆盖范围', () => {
    const body = reviewPromptBody({ workspace, taskId: 't-x', gateId: 'g-sec-code', reviewer: 'sec-code', covers: ['n2-impl'] })
    expect(body).toContain('sec-code')
    expect(body).toContain(`.devzero/tasks/t-x/handoffs/`)
    expect(body).toContain('n2-impl')
  })
})
