/**
 * R1 账本（T4）——单级 task 模型 + 事件流 + 热冷归档。
 * 落盘形态真源：设计文档 2026-08-26-协同编排-design.md §7（§7.1 布局分层 / §7.2 flow-state 字段 / §7.3 事件壳）。
 *
 * 布局分层：账本主存储在 dataDir 侧（<dataDir>/tasks/<id>/）；工作区侧（<workspace>/.devzero/）
 * init 时同步落 TASK.md、AGENTS.md 引用行、.mcp.json 三样，不落账本副本。
 *
 * write 顺序红线（设计 §7.4 ⑥）：先 append events.jsonl（注入 seq/ts）再原子写 flow-state.json
 * （tmp+rename，1.0 flow_state._write_doc 对应）——「事件丢一行可容忍、状态文件是真相源」。
 */
import { randomUUID } from 'node:crypto'
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { dump as yamlDump } from 'js-yaml'
import { engineEventSchema, type EngineEvent } from '../schema/events'
import type { NodeTable } from '../schema/node-table'
import type { TaskState } from '../r2/state'
import { archiveDir, taskDir, type EngineDirs, type TaskMeta } from './paths'

/** 发起任务入参（T5 门面同形契约——T5 engine.ts re-export 本定义） */
export interface CreateTaskInput {
  mode: 'team' | 'solo'
  flow?: string
  employee?: string
  workspace: string
  title: string
  input: string
  base?: string
  model?: string
  effort?: string
}

/** 账本错误——message 含定位路径（坏盘不静默） */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerError'
  }
}

export interface Ledger {
  /** 建任务目录+表快照+flow-state 初值+工作区三样（TASK.md/AGENTS.md 行/.mcp.json）。不做 run.created 事件 */
  init(input: CreateTaskInput, table: NodeTable): { task_id: string }
  /** 读 flow-state.json，返回 state/meta 合并视图（缺文件/坏 JSON 抛 LedgerError 含路径；归档侧兜底） */
  read(taskId: string): { state: TaskState; meta: TaskMeta }
  /** 先 append events.jsonl（注入 seq/ts + schema 校验）再原子写 flow-state（updated_at 刷新）。终态不自动归档 */
  write(taskId: string, next: TaskState, newEvents: EngineEvent[]): void
  /** 逐行读事件（坏行跳过——1.0 容错语义），afterSeq 之后（seq > afterSeq）；活动目录优先、归档兜底 */
  readEvents(taskId: string, afterSeq?: number): EngineEvent[]
  /** 整目录移到 <dataDir>/archive/tasks/<id>；目标占用换 .r2/.r3 代际名 */
  archive(taskId: string): void
  /** 活动目录扫描（坏目录跳过；空/缺目录返回 []） */
  list(): { task_id: string; status: string; title: string }[]
  /** 归档目录扫描（看板历史，语义同 list） */
  listArchive(): { task_id: string; status: string; title: string }[]
}

const FLOW_STATE = 'flow-state.json'
const EVENTS = 'events.jsonl'
const SNAPSHOT = 'table.snapshot.yml'
const HANDOFFS = 'handoffs'

const AGENTS_LINE = '- DevZero 任务上下文见 .devzero/TASK.md（编排引擎工具与当前状态）'
const MCP_JSON = '{"mcpServers":{"devzero-engine":{"type":"http","url":"http://127.0.0.1:19980/mcp"}}}'

/** UTC ISO 时间戳（ms 精度，避免同秒碰撞） */
const nowIso = (): string => new Date().toISOString()

/** task_id = 't-' + 12 位随机（crypto.randomUUID 去连字符截取） */
const newTaskId = (): string => `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`

/** flow-state.json 落盘形态：meta + state 扁平合并（设计 §7.2 样例同形） */
type FlowStateDoc = TaskMeta & TaskState

function renderTaskMd(meta: TaskMeta, state: TaskState): string {
  const flowLabel = meta.display_name ? `${meta.flow}（${meta.display_name}）` : meta.flow
  return [
    '# DevZero 任务',
    '',
    `- task_id: ${meta.task_id}`,
    `- flow: ${flowLabel}`,
    `- title: ${meta.title}`,
    `- workspace: ${meta.workspace}`,
    `- 当前节点: ${state.current_node ?? '—'}`,
    '',
    '## 引擎工具',
    '',
    '（经 MCP `devzero-engine` 调用；对底座会话直接说工具名即可）',
    '',
    '- `engine_next_step` —— 查看当前节点与可执行动作',
    '- `engine_advance` —— 推进到下一节点',
    '- `engine_record_gate` —— 回报评审/验收/裁决结果',
    '- `engine_confirm_gate` —— 人工闸放行（approve/reject）',
    '- `engine_dispatch_done` —— 员工完成派发回报',
    '- `engine_handoff_write` —— 写交接产物摘要',
    '',
    '任务上下文账本由编排引擎维护；人工闸停靠时对底座会话说『批准』即可放行。',
    '',
  ].join('\n')
}

/** 工作区侧落位：TASK.md + AGENTS.md 引用行（幂等追加，不覆盖）+ .mcp.json */
function writeWorkspaceArtifacts(input: CreateTaskInput, meta: TaskMeta, state: TaskState): void {
  const dz = join(input.workspace, '.devzero')
  mkdirSync(dz, { recursive: true }) // workspace 侧目录不存在则建；workspace 已有内容不失败
  writeFileSync(join(dz, 'TASK.md'), renderTaskMd(meta, state))

  const agentsPath = join(input.workspace, 'AGENTS.md')
  const prev = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
  if (!prev.includes(AGENTS_LINE)) {
    // 无则建、有则尾部追加一行（补分隔换行）；同 workspace 多任务幂等——不重复堆叠
    writeFileSync(agentsPath, prev ? `${prev.endsWith('\n') ? prev : `${prev}\n`}${AGENTS_LINE}\n` : `${AGENTS_LINE}\n`)
  }

  writeFileSync(join(input.workspace, '.mcp.json'), MCP_JSON)
}

/** 原子写 flow-state：同目录 tmp + rename（1.0 flow_state._write_doc 对应），失败清 tmp 重抛 */
function writeFlowStateAtomic(dir: string, doc: FlowStateDoc): void {
  const target = join(dir, FLOW_STATE)
  const tmp = join(dir, `.flow-state-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    renameSync(tmp, target)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

function readFlowState(dir: string): FlowStateDoc {
  const target = join(dir, FLOW_STATE)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (err) {
    throw new LedgerError(`[ledger] flow-state.json 读取失败: ${target}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw) as FlowStateDoc
  } catch (err) {
    throw new LedgerError(`[ledger] flow-state.json 损坏（坏 JSON）: ${target}: ${(err as Error).message}`)
  }
}

/** 活动目录优先、归档兜底（归档后 read/readEvents 仍可读历史）；两侧都无 → LedgerError 含路径 */
function resolveTaskDir(dirs: EngineDirs, taskId: string): string {
  const active = taskDir(dirs, taskId)
  if (existsSync(active)) return active
  const archived = archiveDir(dirs, taskId)
  if (existsSync(archived)) return archived
  throw new LedgerError(`[ledger] 任务不存在: ${active}（亦未见于归档 ${archived}）`)
}

function readEventsFile(dir: string): EngineEvent[] {
  const target = join(dir, EVENTS)
  if (!existsSync(target)) return []
  const events: EngineEvent[] = []
  for (const line of readFileSync(target, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(engineEventSchema.parse(JSON.parse(line)))
    } catch {
      // 坏行跳过（1.0 容错语义）——事件文件 append-only，一行坏不拖垮整读
    }
  }
  return events
}

/** 扫任务根目录（活动或归档）出三字段行；坏目录跳过 */
function scanTasks(rootDir: string): { task_id: string; status: string; title: string }[] {
  if (!existsSync(rootDir)) return []
  const rows: { task_id: string; status: string; title: string }[] = []
  for (const ent of readdirSync(rootDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    try {
      const doc = readFlowState(join(rootDir, ent.name))
      rows.push({ task_id: doc.task_id, status: String(doc.status), title: String(doc.title) })
    } catch {
      // 坏目录跳过（无 flow-state/坏 JSON）——列表不被单任务拖垮
    }
  }
  rows.sort((a, b) => a.task_id.localeCompare(b.task_id))
  return rows
}

export function createLedger(dirs: EngineDirs): Ledger {
  return {
    init(input, table) {
      const taskId = newTaskId()
      const dir = taskDir(dirs, taskId)
      mkdirSync(join(dir, HANDOFFS), { recursive: true })
      writeFileSync(join(dir, EVENTS), '') // 空文件占位——init 不发事件（run.created 由 T5 门面发）

      const now = nowIso()
      const meta: TaskMeta = {
        task_id: taskId,
        flow: table.flow,
        title: input.title,
        workspace: input.workspace,
        ...(table.display_name !== undefined ? { display_name: table.display_name } : {}),
        created_at: now,
        updated_at: now,
      }
      const state: TaskState = {
        status: 'in_progress',
        current_node: table.nodes[0].id,
        gate_iters: {},
        gate_calls: 0,
        retries: {},
        blocked_reason: null,
      }
      // 表快照：入参已解析 NodeTable 原样 dump（solo 动态表同经此路径）
      writeFileSync(join(dir, SNAPSHOT), yamlDump(table))
      writeFlowStateAtomic(dir, { ...meta, ...state })

      writeWorkspaceArtifacts(input, meta, state)
      return { task_id: taskId }
    },

    read(taskId) {
      const doc = readFlowState(resolveTaskDir(dirs, taskId))
      const {
        status, current_node, gate_iters, gate_calls, retries, blocked_reason,
        ...meta
      } = doc
      return {
        state: { status, current_node, gate_iters, gate_calls, retries, blocked_reason },
        meta,
      }
    },

    write(taskId, next, newEvents) {
      const dir = resolveTaskDir(dirs, taskId)
      const meta = readFlowState(dir)

      // ① 先校验整批（注入 seq/ts）后落盘——一条非法则一行不写
      // seq=已有行数+自增（原始行计——坏行也占号，永不回拨/复用）
      const eventsPath = join(dir, EVENTS)
      const existing = existsSync(eventsPath)
        ? readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.trim() !== '').length
        : 0
      const completed: EngineEvent[] = newEvents.map((e, i) => {
        const candidate = { ...e, seq: existing + i + 1, ts: e.ts && e.ts.length > 0 ? e.ts : nowIso() }
        const parsed = engineEventSchema.safeParse(candidate)
        if (!parsed.success) {
          throw new LedgerError(
            `[ledger] 非法事件（schema 校验失败）batch[${i}] seq=${candidate.seq}: ` +
            parsed.error.issues.map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`).join('；'),
          )
        }
        return parsed.data
      })
      if (completed.length > 0) {
        appendFileSync(join(dir, EVENTS), completed.map((e) => JSON.stringify(e)).join('\n') + '\n')
      }

      // ② 再原子写 flow-state（meta+next 合并，updated_at 刷新；终态不自动归档——调用方显式 archive）
      writeFlowStateAtomic(dir, { ...meta, ...next, updated_at: nowIso() })
    },

    readEvents(taskId, afterSeq = 0) {
      return readEventsFile(resolveTaskDir(dirs, taskId)).filter((e) => e.seq > afterSeq)
    },

    archive(taskId) {
      const src = taskDir(dirs, taskId)
      if (!existsSync(src)) {
        throw new LedgerError(`[ledger] archive 失败——活动任务不存在: ${src}`)
      }
      // 目标占用 → .r2/.r3 代际名（首个可用）
      let dest = archiveDir(dirs, taskId)
      for (let gen = 2; existsSync(dest); gen++) {
        dest = `${archiveDir(dirs, taskId)}.r${gen}`
      }
      mkdirSync(dirname(dest), { recursive: true })
      renameSync(src, dest)
    },

    list() {
      return scanTasks(join(dirs.dataDir, 'tasks'))
    },

    listArchive() {
      return scanTasks(join(dirs.dataDir, 'archive', 'tasks'))
    },
  }
}
