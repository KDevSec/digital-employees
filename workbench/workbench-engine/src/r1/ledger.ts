/**
 * R1 账本（T4 修复版）——单级 task 模型 + 事件流 + 热冷归档。
 * 落盘形态真源：设计文档 2026-08-26-协同编排-design.md §7（§7.1 布局 / §7.2 flow-state / §7.3 事件壳）。
 *
 * 布局（D-045）：活动账本在 <workspace>/.devzero/tasks/<id>/；完成归档搬 <dataDir>/archive/tasks/<id>；
 * dataDir 侧 tasks-index.json 轻量索引（定位/列表之源——活动目录分散各 workspace 需反查）。
 *
 * write 顺序红线（设计 §7.4 ⑥）：先 append events.jsonl（注入 seq/ts）再原子写 flow-state.json
 * （tmp+rename，1.0 flow_state._write_doc 对应）——「事件丢一行可容忍、状态文件是真相源」。
 */
import { randomUUID } from 'node:crypto'
import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { dump as yamlDump } from 'js-yaml'
import { engineEventSchema, type EngineEvent } from '../schema/events'
import type { NodeTable } from '../schema/node-table'
import type { TaskState } from '../r2/state'
import { archiveDir, indexPath, taskDir, type EngineDirs, type IndexEntry, type TaskMeta } from './paths'

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

/** 账本错误——message 含定位路径（坏盘不静默）；cause 链保留原始错误（init 回滚等） */
export class LedgerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LedgerError'
  }
}

/** @internal 测试注入钩子：rename/rm 失败场景模拟（归档占用兜底分支覆盖） */
export interface LedgerHooks {
  rename?: (src: string, dest: string) => void
  rm?: (target: string) => void
}

export interface Ledger {
  /** 建 <ws>/.devzero/tasks/<id>/ 账本 + 工作区三样（TASK.md/AGENTS.md 行/.mcp.json）+ 索引行。
   *  失败全量回滚（账本目录/索引行/本次新建的 .devzero 骨架）。不做 run.created 事件 */
  init(input: CreateTaskInput, table: NodeTable): { task_id: string }
  /** 经索引定位读 flow-state（归档任务可读历史）；缺行/目录缺失/坏 JSON 抛 LedgerError 含定位 */
  read(taskId: string): { state: TaskState; meta: TaskMeta }
  /** 仅活动任务：先 append events.jsonl（注入 seq/ts + schema 校验 + 尾行换行防御）再原子写
   *  flow-state（updated_at 刷新）+ 同步索引行 status；已归档任务拒绝写。终态不自动归档 */
  write(taskId: string, next: TaskState, newEvents: EngineEvent[]): void
  /** 逐行读事件（坏行跳过——1.0 容错语义），afterSeq 之后（seq > afterSeq）；归档任务可读 */
  readEvents(taskId: string, afterSeq?: number): EngineEvent[]
  /** 幂等（已归档 no-op）；工作区账本目录 → <dataDir>/archive/tasks/<id>（占用换 .r2/.r3）；
   *  Windows 占用对策：rename 重试 1 次 → copy+rm 兜底（rm 失败则索引已切归档侧、抛错留人工清理） */
  archive(taskId: string): void
  /** 活动任务（索引 archived:false 行） */
  list(): { task_id: string; status: string; title: string }[]
  /** 归档任务（索引 archived:true 行，看板历史） */
  listArchive(): { task_id: string; status: string; title: string }[]
}

const FLOW_STATE = 'flow-state.json'
const EVENTS = 'events.jsonl'
const SNAPSHOT = 'table.snapshot.yml'
const HANDOFFS = 'handoffs'

const AGENTS_LINE = '- DevZero 任务上下文见 .devzero/TASK.md（编排引擎工具与当前状态）'
const GITIGNORE_LINE = '.devzero/'
const MCP_JSON = '{"mcpServers":{"devzero-engine":{"type":"http","url":"http://127.0.0.1:19980/mcp"}}}'

/** UTC ISO 时间戳（ms 精度，避免同秒碰撞） */
const nowIso = (): string => new Date().toISOString()

/** task_id = 't-' + 12 位随机（crypto.randomUUID 去连字符截取） */
const newTaskId = (): string => `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`

/** flow-state.json 落盘形态：meta + state 扁平合并（设计 §7.2 样例同形） */
type FlowStateDoc = TaskMeta & TaskState

type TaskIndexDoc = { tasks: Record<string, IndexEntry> }

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

  // .gitignore：账本不随用户 git 入库（设计 §7.1）——无则建、有则检测追加（同 AGENTS.md 模式，幂等）
  const giPath = join(input.workspace, '.gitignore')
  const prevGi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''
  if (!prevGi.split('\n').some((l) => l.trim() === GITIGNORE_LINE)) {
    writeFileSync(giPath, prevGi ? `${prevGi.endsWith('\n') ? prevGi : `${prevGi}\n`}${GITIGNORE_LINE}\n` : `${GITIGNORE_LINE}\n`)
  }
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

/** 读任务索引：不存在 → 空索引；坏 JSON → LedgerError 含路径（不静默清空） */
function readIndex(dirs: EngineDirs): TaskIndexDoc {
  const p = indexPath(dirs)
  if (!existsSync(p)) return { tasks: {} }
  try {
    const doc: unknown = JSON.parse(readFileSync(p, 'utf8'))
    // 形状校验（⚪3）：顶层非对象/tasks 缺失 → LedgerError（坏结构不静默当空索引）
    if (typeof doc !== 'object' || doc === null || typeof (doc as TaskIndexDoc).tasks !== 'object') {
      throw new Error('顶层结构非 { tasks: {...} }')
    }
    return doc as TaskIndexDoc
  } catch (err) {
    throw new LedgerError(`[ledger] tasks-index.json 损坏（坏 JSON 或坏结构）: ${p}: ${(err as Error).message}`)
  }
}

/** 原子写索引（dataDir + tmp + rename） */
function writeIndexAtomic(dirs: EngineDirs, doc: TaskIndexDoc): void {
  mkdirSync(dirs.dataDir, { recursive: true })
  const target = indexPath(dirs)
  const tmp = join(dirs.dataDir, `.tasks-index-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    renameSync(tmp, target)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** 归档侧探测（🟡4 孤儿窗口）：archive root 下找 <taskId> 或 <taskId>.rN 代际目录——
 *  archive 搬运成功+索引写失败的窗口自愈之读侧（命中即可读，不改索引——写侧自愈在 archive 重试路径） */
function probeArchiveDir(dirs: EngineDirs, taskId: string): string | null {
  const root = join(dirs.dataDir, 'archive', 'tasks')
  if (!existsSync(root)) return null
  const hit = readdirSync(root).find((n) => n === taskId || n.startsWith(`${taskId}.r`))
  return hit ? join(root, hit) : null
}

/** 经索引定位任务目录（归档任务走 archive_path；活动走工作区；活动目录缺失时归档侧探测兜底） */
function resolveTask(dirs: EngineDirs, taskId: string): { dir: string; entry: IndexEntry } {
  const entry = readIndex(dirs).tasks[taskId]
  if (!entry) {
    throw new LedgerError(`[ledger] 任务不存在于索引: ${taskId}（index: ${indexPath(dirs)}）`)
  }
  const dir = entry.archived && entry.archive_path ? entry.archive_path : taskDir(entry.workspace, taskId)
  if (existsSync(dir)) return { dir, entry }
  // 🟡4 孤儿窗口读侧兜底：索引仍记活动但目录已搬（archive 索引写失败窗口）——归档侧探测降级可读
  const probed = probeArchiveDir(dirs, taskId)
  if (probed) return { dir: probed, entry }
  throw new LedgerError(`[ledger] 任务目录缺失: ${dir}（task ${taskId}${entry.archived ? ' archived' : ''}）`)
}

/** 索引行 → 列表行（按 archived 分区，task_id 排序） */
function indexRows(dirs: EngineDirs, archived: boolean): { task_id: string; status: string; title: string }[] {
  return Object.entries(readIndex(dirs).tasks)
    .filter(([, e]) => e.archived === archived)
    .map(([task_id, e]) => ({ task_id, status: e.status, title: e.title }))
    .sort((a, b) => a.task_id.localeCompare(b.task_id))
}

export function createLedger(dirs: EngineDirs, hooks: LedgerHooks = {}): Ledger {
  const doRename = hooks.rename ?? ((src: string, dest: string) => renameSync(src, dest))
  const doRm = hooks.rm ?? ((target: string) => rmSync(target, { recursive: true, force: true }))

  return {
    init(input, table) {
      const taskId = newTaskId()
      const wsDz = join(input.workspace, '.devzero')
      const dzExisted = existsSync(wsDz)
      const dir = taskDir(input.workspace, taskId)
      const now = nowIso()
      const meta: TaskMeta = {
        task_id: taskId,
        flow: table.flow,
        title: input.title,
        workspace: input.workspace,
        ...(table.display_name !== undefined ? { display_name: table.display_name } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
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
      try {
        mkdirSync(join(dir, HANDOFFS), { recursive: true })
        writeFileSync(join(dir, EVENTS), '') // 空文件占位——init 不发事件（run.created 由 T5 门面发）
        // 表快照：入参已解析 NodeTable 原样 dump（solo 动态表同经此路径）
        writeFileSync(join(dir, SNAPSHOT), yamlDump(table))
        writeFlowStateAtomic(dir, { ...meta, ...state })
        writeWorkspaceArtifacts(input, meta, state) // 工作区三样（失败 → 回滚重抛）

        const idx = readIndex(dirs) // 索引最后写——工作区全部成功才入索引
        idx.tasks[taskId] = {
          workspace: input.workspace, flow: table.flow, title: input.title,
          status: state.status, archived: false, archive_path: null, created_at: now, updated_at: now,
        }
        writeIndexAtomic(dirs, idx)
      } catch (err) {
        // 全量回滚：账本目录 + 本次新建的 .devzero 骨架（已存在则只清本次 TASK.md；.mcp.json 多任务共享不清；
        // AGENTS.md 引用行幂等无害保留）。索引未写（最后一步）——无需回滚，但防御性删行。
        rmSync(dir, { recursive: true, force: true })
        if (!dzExisted) {
          try { rmSync(wsDz, { recursive: true, force: true }) } catch { /* 回滚尽力而为 */ }
        } else {
          try { rmSync(join(wsDz, 'TASK.md'), { force: true }) } catch { /* 回滚尽力而为 */ }
        }
        throw new LedgerError(`[ledger] init 失败已回滚（task ${taskId}）: ${(err as Error).message}`, { cause: err })
      }
      return { task_id: taskId }
    },

    read(taskId) {
      const doc = readFlowState(resolveTask(dirs, taskId).dir)
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
      const { dir, entry } = resolveTask(dirs, taskId)
      if (entry.archived) {
        throw new LedgerError(`[ledger] task '${taskId}' archived; write rejected`)
      }
      const meta = readFlowState(dir)

      // ① 先校验整批（注入 seq/ts）后落盘——一条非法则一行不写
      // seq=已有行数+自增（原始行计——坏行也占号，永不回拨/复用）
      const eventsPath = join(dir, EVENTS)
      const raw = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : ''
      const existing = raw.split('\n').filter((l) => l.trim() !== '').length
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
        // 尾行换行防御：crash-mid-append 残行（非空且不以 \n 结尾）→ 先补换行，新事件独立成行
        const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : ''
        appendFileSync(eventsPath, `${prefix}${completed.map((e) => JSON.stringify(e)).join('\n')}\n`)
      }

      // ② 再原子写 flow-state（meta+next 合并，updated_at 刷新；终态不自动归档——调用方显式 archive）
      writeFlowStateAtomic(dir, { ...meta, ...next, updated_at: nowIso() })

      // ③ 同步索引行（status/updated_at）
      const idx = readIndex(dirs)
      const row = idx.tasks[taskId]
      if (row) {
        row.status = next.status
        row.updated_at = nowIso()
        writeIndexAtomic(dirs, idx)
      }
    },

    readEvents(taskId, afterSeq = 0) {
      return readEventsFile(resolveTask(dirs, taskId).dir).filter((e) => e.seq > afterSeq)
    },

    archive(taskId) {
      const idx = readIndex(dirs)
      const entry = idx.tasks[taskId]
      if (!entry) {
        throw new LedgerError(`[ledger] archive 失败——任务不存在于索引: ${taskId}（index: ${indexPath(dirs)}）`)
      }
      if (entry.archived) return // 幂等：已归档 no-op

      const src = taskDir(entry.workspace, taskId)
      if (!existsSync(src)) {
        // 🟡4 孤儿窗口写侧自愈：目录已到归档侧（索引写失败窗口）——补索引行后按幂等 no-op
        const probed = probeArchiveDir(dirs, taskId)
        if (probed) {
          entry.archived = true
          entry.archive_path = probed
          entry.updated_at = nowIso()
          writeIndexAtomic(dirs, idx)
          return
        }
        throw new LedgerError(`[ledger] archive 失败——活动目录缺失: ${src}`)
      }
      // 目标占用 → .r2/.r3 代际名（首个可用）
      let dest = archiveDir(dirs, taskId)
      for (let gen = 2; existsSync(dest); gen++) {
        dest = `${archiveDir(dirs, taskId)}.r${gen}`
      }
      mkdirSync(dirname(dest), { recursive: true })

      // Windows 占用对策（1.0 坑②路径版）：rename 重试 1 次 → copy+rm 兜底；
      // rm 失败（源被观战流/编辑器持句柄）→ 索引已切归档侧（读走 archive_path），抛错留人工清理
      try {
        doRename(src, dest)
      } catch {
        try {
          doRename(src, dest)
        } catch {
          cpSync(src, dest, { recursive: true })
          try {
            doRm(src)
          } catch (rmErr) {
            entry.archived = true
            entry.archive_path = dest
            entry.updated_at = nowIso()
            writeIndexAtomic(dirs, idx)
            throw new LedgerError(
              `[ledger] archive copy 兜底完成但源删除失败（双存在，读已切归档侧，请人工清理）: ${src}: ${(rmErr as Error).message}`,
              { cause: rmErr },
            )
          }
        }
      }
      // 成功路径统一更新索引（rm 失败分支已 throw 并自行更新，不会到达此处）
      entry.archived = true
      entry.archive_path = dest
      entry.updated_at = nowIso()
      writeIndexAtomic(dirs, idx)
    },

    list() {
      return indexRows(dirs, false)
    },

    listArchive() {
      return indexRows(dirs, true)
    },
  }
}
