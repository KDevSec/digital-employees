/**
 * R1 账本（T4 修复版）——单级 task 模型 + 事件流 + 热冷归档 + 工作区可发现性。
 * 布局（D-045）：活动账本 <workspace>/.devzero/tasks/<id>/；归档 <dataDir>/archive/tasks/<id>；
 * dataDir 侧 tasks-index.json 索引定位。落盘形态真源：设计文档 §7。
 * 纪律 P-11：每用例独立临时夹具（dataDir/templatesDir/workspace 一律 mkdtemp），测毕清理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { parseNodeTable, type NodeTable } from '../src/schema/node-table'
import type { EngineEvent } from '../src/schema/events'
import type { TaskState } from '../src/r2/state'
import { archiveDir, indexPath, taskDir, type EngineDirs, type IndexEntry } from '../src/r1/paths'
import { createLedger, LedgerError, type CreateTaskInput, type Ledger } from '../src/r1/ledger'

/** 契约真源真表：assets/flows/demo-flow.node-table.yml（设计文档 §6.1） */
const table: NodeTable = parseNodeTable(
  yamlLoad(readFileSync(fileURLToPath(new URL('../assets/flows/demo-flow.node-table.yml', import.meta.url)), 'utf8')),
)

const AGENTS_LINE = '- DevZero 任务上下文见 .devzero/TASK.md（编排引擎工具与当前状态）'
const MCP_JSON = '{"mcpServers":{"devzero-engine":{"type":"http","url":"http://127.0.0.1:19980/mcp"}}}'

const stateA: TaskState = {
  status: 'in_progress', current_node: 'n0-req',
  gate_iters: {}, gate_calls: 0, retries: {}, blocked_reason: null,
}
const stateB: TaskState = {
  status: 'gate_paused', current_node: 'g-req-review',
  gate_iters: { 'g-req-review': 1 }, gate_calls: 1, retries: {}, blocked_reason: null,
}

/** 事件构造：seq/ts 由账本注入（占位 0/''），调用方只给通用壳外的载荷 */
const ev = (traceId: string, type: EngineEvent['type'], extra: Record<string, unknown> = {}): EngineEvent =>
  ({
    seq: 0, ts: '', trace_id: traceId, parent_seq: null, actor: 'engine', flow: 'demo-flow', type, ...extra,
  }) as unknown as EngineEvent

const batch1 = (id: string): EngineEvent[] => [
  ev(id, 'transition', { ts: '2026-08-26T08:00:00.000Z', from: 'n-adm', to: 'n0-req', status: 'in_progress' }),
  ev(id, 'dispatch', { phase: 'start', emp: 'req-clarifier', dispatch_id: 'd-1', node: 'n0-req' }),
]
const batch2 = (id: string): EngineEvent[] => [
  ev(id, 'transition', { from: 'n0-req', to: 'g-req-review', status: 'gate_paused' }),
  ev(id, 'gate', { gate: 'g-req-review', kind: 'review', node: 'g-req-review', verdict: 'FAIL', iter: 1, reviewer: 'reviewer-expert' }),
  ev(id, 'dispatch', { phase: 'done', emp: 'req-clarifier', dispatch_id: 'd-1', node: 'n0-req', status: 'done' }),
]

let root: string
let dirs: EngineDirs
let workspace: string
let ledger: Ledger

const mkInput = (): CreateTaskInput => ({
  mode: 'team', flow: 'demo-flow', workspace, title: '登录页交付', input: '做一个登录页',
})

/** 读索引（测试侧直读，断言索引行为） */
const readIndexRaw = (): { tasks: Record<string, IndexEntry> } =>
  JSON.parse(readFileSync(indexPath(dirs), 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'r1-ledger-'))
  dirs = { dataDir: join(root, 'data'), templatesDir: join(root, 'templates') }
  workspace = join(root, 'ws')
  mkdirSync(workspace, { recursive: true })
  ledger = createLedger(dirs)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('R1 账本 · init 落盘形态（工作区布局 D-045）', () => {
  it('账本目录在 <ws>/.devzero/tasks/<id>：三文件 + handoffs/，flow-state 初值逐字段，init 不发事件', () => {
    const { task_id } = ledger.init(mkInput(), table)
    expect(task_id.startsWith('t-')).toBe(true)

    const dir = taskDir(workspace, task_id)
    expect(dir.startsWith(join(workspace, '.devzero', 'tasks'))).toBe(true)
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, 'flow-state.json'))).toBe(true)
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'table.snapshot.yml'))).toBe(true)
    expect(existsSync(join(dir, 'handoffs'))).toBe(true)

    // init 不做 run.created（事件由 T5 门面发）——events.jsonl 落空文件
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8')).toBe('')

    const doc = JSON.parse(readFileSync(join(dir, 'flow-state.json'), 'utf8'))
    expect(doc).toMatchObject({
      task_id, flow: 'demo-flow', title: '登录页交付', workspace, display_name: '五阶段演示交付',
      status: 'in_progress', current_node: 'n-adm',
      gate_iters: {}, gate_calls: 0, retries: {}, blocked_reason: null,
    })
    expect(typeof doc.created_at).toBe('string')
    expect(doc.created_at.length).toBeGreaterThan(0)
    expect(doc.updated_at).toBe(doc.created_at)
  })

  it('索引行落盘：tasks-index.json 字段逐项（定位/列表之源）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const idx = readIndexRaw()
    expect(idx.tasks[task_id]).toMatchObject({
      workspace, flow: 'demo-flow', title: '登录页交付',
      status: 'in_progress', archived: false, archive_path: null,
    })
    expect(typeof idx.tasks[task_id].created_at).toBe('string')
  })

  it('工作区侧：TASK.md 三锚 + .mcp.json 逐字 + snapshot 可 yaml load 回', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const dir = taskDir(workspace, task_id)

    const taskMd = readFileSync(join(workspace, '.devzero', 'TASK.md'), 'utf8')
    expect(taskMd).toContain(task_id)
    expect(taskMd).toContain('demo-flow')
    expect(taskMd).toContain('engine_confirm_gate')

    expect(readFileSync(join(workspace, '.mcp.json'), 'utf8')).toBe(MCP_JSON)

    const snap = yamlLoad(readFileSync(join(dir, 'table.snapshot.yml'), 'utf8')) as NodeTable
    expect(snap.flow).toBe('demo-flow')
    expect(snap.nodes).toHaveLength(table.nodes.length)
  })

  it('AGENTS.md 无 → 建且含引用行', () => {
    ledger.init(mkInput(), table)
    const agents = readFileSync(join(workspace, 'AGENTS.md'), 'utf8')
    expect(agents).toContain(AGENTS_LINE)
  })

  it('AGENTS.md 有内容 → 原内容保留 + 尾部追加行（不覆盖）', () => {
    writeFileSync(join(workspace, 'AGENTS.md'), '原有内容') // 故意无尾换行
    ledger.init(mkInput(), table)
    const agents = readFileSync(join(workspace, 'AGENTS.md'), 'utf8')
    expect(agents.startsWith('原有内容\n')).toBe(true)
    expect(agents.trimEnd().endsWith(AGENTS_LINE)).toBe(true)
  })

  it('init 失败全量回滚：workspace 非法路径 → LedgerError（cause 链）+ 无索引行 + 无任务目录', () => {
    const bad = { ...mkInput(), workspace: join(root, 'bad<name') } // Windows 非法路径字符 → mkdir/write 抛
    expect(() => ledger.init(bad, table)).toThrow(LedgerError)
    try {
      ledger.init(bad, table)
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toContain('init 失败已回滚')
      expect((err as Error).cause).toBeDefined()
    }
    expect(ledger.list()).toEqual([]) // 索引无残留行
    expect(ledger.listArchive()).toEqual([])
  })
})

describe('R1 账本 · write/read 往返', () => {
  it('两批事件+状态：seq 连续注入、ts 注入（显式保留）、state/meta 合并、updated_at 刷新、索引 status 同步', () => {
    const { task_id } = ledger.init(mkInput(), table)
    ledger.write(task_id, stateA, batch1(task_id))
    expect(ledger.readEvents(task_id).map((e) => e.seq)).toEqual([1, 2])

    // 手工把 updated_at 植成陈旧值 → write 后必刷新（确定性断言，避开同毫秒）
    const stPath = join(taskDir(workspace, task_id), 'flow-state.json')
    const doc = JSON.parse(readFileSync(stPath, 'utf8'))
    doc.updated_at = '2000-01-01T00:00:00.000Z'
    writeFileSync(stPath, JSON.stringify(doc))

    ledger.write(task_id, stateB, batch2(task_id))

    const events = ledger.readEvents(task_id)
    expect(events).toHaveLength(5)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(events.every((e) => e.trace_id === task_id)).toBe(true)
    expect(events.every((e) => e.ts.length > 0)).toBe(true) // ts 已注入
    expect(events[0].ts).toBe('2026-08-26T08:00:00.000Z') // 显式 ts 保留

    const first = ledger.read(task_id)
    expect(first.state).toEqual(stateB)
    expect(first.meta).toMatchObject({
      task_id, flow: 'demo-flow', title: '登录页交付', workspace, display_name: '五阶段演示交付',
    })
    expect(first.meta.updated_at).not.toBe('2000-01-01T00:00:00.000Z')
    expect(ledger.read(task_id)).toEqual(first) // read 幂等（两次一致）

    // 索引行 status 同步
    expect(readIndexRaw().tasks[task_id].status).toBe('gate_paused')
  })
})

describe('R1 账本 · 单级 task 模型', () => {
  it('同 workspace 二次 init → 新 task_id 新目录，互不干扰，list 两行', () => {
    const a = ledger.init(mkInput(), table)
    const b = ledger.init(mkInput(), table)
    expect(a.task_id).not.toBe(b.task_id)
    expect(existsSync(taskDir(workspace, a.task_id))).toBe(true)
    expect(existsSync(taskDir(workspace, b.task_id))).toBe(true)

    const rows = ledger.list()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.task_id))).toEqual(new Set([a.task_id, b.task_id]))
    for (const r of rows) {
      expect(r.status).toBe('in_progress')
      expect(r.title).toBe('登录页交付')
    }

    // 互不干扰：写 a 不影响 b
    ledger.write(a.task_id, stateA, batch1(a.task_id))
    expect(ledger.read(b.task_id).state.current_node).toBe('n-adm')
    expect(ledger.readEvents(b.task_id)).toHaveLength(0)
  })
})

describe('R1 账本 · archive 热冷分层', () => {
  it('归档：工作区活动目录消失、归档目录可读原事件、索引切 archive_path、list 分区正确', () => {
    const { task_id } = ledger.init(mkInput(), table)
    ledger.write(task_id, stateA, batch1(task_id))
    ledger.write(task_id, stateB, batch2(task_id))

    ledger.archive(task_id)

    expect(existsSync(taskDir(workspace, task_id))).toBe(false) // 工作区侧搬走
    const dest = archiveDir(dirs, task_id)
    expect(existsSync(dest)).toBe(true)
    expect(ledger.readEvents(task_id)).toHaveLength(5) // 归档侧可读（历史详情）
    expect(readIndexRaw().tasks[task_id]).toMatchObject({ archived: true, archive_path: dest })

    expect(ledger.list().map((r) => r.task_id)).not.toContain(task_id)
    const arows = ledger.listArchive()
    const row = arows.find((r) => r.task_id === task_id)
    expect(row).toBeDefined()
    expect(row!.status).toBe('gate_paused')
    expect(row!.title).toBe('登录页交付')
  })

  it('归档幂等：已归档再 archive → no-op（不抛、不增代际）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    ledger.archive(task_id)
    const dest1 = readIndexRaw().tasks[task_id].archive_path
    expect(() => ledger.archive(task_id)).not.toThrow()
    expect(readIndexRaw().tasks[task_id].archive_path).toBe(dest1)
    expect(existsSync(`${archiveDir(dirs, task_id)}.r2`)).toBe(false)
  })

  it('目标占用 → 落 .r2 代际名（索引 archive_path 指向代际目录）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    mkdirSync(archiveDir(dirs, task_id), { recursive: true }) // 预占同名归档目录

    ledger.archive(task_id)

    expect(existsSync(taskDir(workspace, task_id))).toBe(false)
    const r2 = join(dirs.dataDir, 'archive', 'tasks', `${task_id}.r2`)
    expect(existsSync(r2)).toBe(true)
    expect(existsSync(join(r2, 'flow-state.json'))).toBe(true)
    expect(readIndexRaw().tasks[task_id].archive_path).toBe(r2)

    const rows = ledger.listArchive() // 索引驱动——占位空目录无索引行不进列表
    expect(rows).toHaveLength(1)
    expect(rows[0].task_id).toBe(task_id)
  })

  it('Windows 占用兜底：rename 恒失败 → copy+rm 兜底落归档（hooks 注入模拟）', () => {
    const failing = createLedger(dirs, {
      rename: () => { throw new Error('EPERM: 目录被占用（模拟）') },
    })
    const { task_id } = failing.init(mkInput(), table)
    failing.write(task_id, stateA, batch1(task_id))

    failing.archive(task_id) // rename 两次失败 → cpSync 兜底 + rm 正常 → 成功归档

    expect(existsSync(taskDir(workspace, task_id))).toBe(false) // rm 兜底删除
    const dest = archiveDir(dirs, task_id)
    expect(existsSync(join(dest, 'flow-state.json'))).toBe(true)
    expect(failing.readEvents(task_id)).toHaveLength(2)
    expect(readIndexRaw().tasks[task_id]).toMatchObject({ archived: true, archive_path: dest })
  })

  it('占用兜底深水区：rm 也失败 → 索引已切归档侧 + LedgerError 留人工清理（双存在）', () => {
    const failing = createLedger(dirs, {
      rename: () => { throw new Error('EPERM: 目录被占用（模拟）') },
      rm: () => { throw new Error('EBUSY: 源被观战流持句柄（模拟）') },
    })
    const { task_id } = failing.init(mkInput(), table)

    try {
      failing.archive(task_id)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError)
      expect((err as Error).message).toContain('请人工清理')
    }
    // 双存在：读已切归档侧（索引 archive_path 优先）；工作区残留留人工
    const dest = archiveDir(dirs, task_id)
    expect(existsSync(join(dest, 'flow-state.json'))).toBe(true)
    expect(existsSync(taskDir(workspace, task_id))).toBe(true)
    expect(readIndexRaw().tasks[task_id]).toMatchObject({ archived: true, archive_path: dest })
    expect(failing.read(task_id).state.current_node).toBe('n-adm') // 归档侧可读
  })

  it('write 已归档任务 → 拒绝（LedgerError，不再走归档兜底写）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    ledger.archive(task_id)

    try {
      ledger.write(task_id, stateA, batch1(task_id))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError)
      expect((err as Error).message).toContain('archived; write rejected')
    }
    expect(ledger.readEvents(task_id)).toHaveLength(0) // 归档侧未被污染
  })
})

describe('R1 账本 · 坏盘容错', () => {
  it('flow-state 坏 JSON → read 抛 LedgerError 含路径；索引缺行 → 含 task_id 与索引路径', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const stPath = join(taskDir(workspace, task_id), 'flow-state.json')
    writeFileSync(stPath, '{ 这不是 JSON')

    expect(() => ledger.read(task_id)).toThrow(LedgerError)
    try {
      ledger.read(task_id)
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toContain(stPath)
    }

    const ghost = 't-000000000000'
    expect(() => ledger.read(ghost)).toThrow(LedgerError)
    try {
      ledger.read(ghost)
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toContain(ghost)
      expect((err as Error).message).toContain(indexPath(dirs))
    }
  })

  it('tasks-index.json 坏 JSON → read/list 抛 LedgerError（不静默清空）', () => {
    ledger.init(mkInput(), table)
    writeFileSync(indexPath(dirs), '{ 坏索引')

    try {
      ledger.list()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError)
      expect((err as Error).message).toContain(indexPath(dirs))
    }
    expect(() => ledger.read('t-any')).toThrow(LedgerError)
  })

  it('events.jsonl 混坏行 → readEvents 跳过返回其余；afterSeq 过滤', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const dir = taskDir(workspace, task_id)
    ledger.write(task_id, stateA, batch1(task_id)) // 2 条
    appendFileSync(join(dir, 'events.jsonl'), '{ 坏行\n')
    ledger.write(task_id, stateA, batch2(task_id).slice(0, 1)) // 1 条（seq 按已有行数=3 → 4）

    expect(ledger.readEvents(task_id).map((e) => e.seq)).toEqual([1, 2, 4])
    expect(ledger.readEvents(task_id, 2).map((e) => e.seq)).toEqual([4])
    expect(ledger.readEvents(task_id, 4)).toEqual([])
  })
})

describe('R1 账本 · write 防线', () => {
  it('非法事件（缺 type）→ LedgerError 且 events.jsonl 未写入（先校验后落盘）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const dir = taskDir(workspace, task_id)
    const bad = {
      seq: 0, ts: '', trace_id: task_id, parent_seq: null, actor: 'engine', flow: 'demo-flow',
    } as unknown as EngineEvent // 缺 seq 之外的必填键 type

    expect(() => ledger.write(task_id, stateA, [batch1(task_id)[0], bad])).toThrow(LedgerError)
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8')).toBe('') // 一行未落
    expect(ledger.read(task_id).state.current_node).toBe('n-adm') // 状态未推进
  })

  it('write 终态不自动归档 + 原子写冒烟（可 parse、无 tmp 残留）', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const terminal: TaskState = { ...stateA, status: 'completed', current_node: 'n-done' }
    ledger.write(task_id, terminal, [ev(task_id, 'run.completed', { final_node: 'n-done', duration_s: 42 })])

    // 终态不自动 archive——归档由调用方显式调（T5 completeTask 控制）
    expect(existsSync(taskDir(workspace, task_id))).toBe(true)
    expect(ledger.list().map((r) => r.task_id)).toContain(task_id)

    // 原子写冒烟：flow-state 可 parse（无半写）+ 任务目录无 tmp 残留
    const doc = JSON.parse(readFileSync(join(taskDir(workspace, task_id), 'flow-state.json'), 'utf8'))
    expect(doc.current_node).toBe('n-done')
    expect(readdirSync(taskDir(workspace, task_id)).sort())
      .toEqual(['events.jsonl', 'flow-state.json', 'handoffs', 'table.snapshot.yml'])
  })

  it('尾行换行防御：crash 残行（无尾 \\n）后 append → 新事件独立成行、seq 不复用', () => {
    const { task_id } = ledger.init(mkInput(), table)
    const eventsPath = join(taskDir(workspace, task_id), 'events.jsonl')

    ledger.write(task_id, stateA, batch1(task_id)) // 2 条（正常带尾 \n）
    const raw = readFileSync(eventsPath, 'utf8')
    writeFileSync(eventsPath, raw.slice(0, -1)) // 手工掐掉尾换行——模拟 crash-mid-append 残行

    ledger.write(task_id, stateA, [ev(task_id, 'gate', {
      gate: 'g-req-review', kind: 'review', node: 'g-req-review', verdict: 'PASS', iter: 1, reviewer: 'reviewer-expert',
    })])

    // 新事件 seq=3（按行数=2 续号）且独立成行（前残行未与其拼合——拼合会少一行且 parse 失败被跳）
    const events = ledger.readEvents(task_id)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events[2].type).toBe('gate')
  })
})
