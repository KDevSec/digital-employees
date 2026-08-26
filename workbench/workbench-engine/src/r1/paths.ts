/**
 * R1 账本路径（T4）——全部接收注入基目录，不做任何环境推断（测试传临时目录）。
 * dataDir = ~/.devzero 对应物（账本主存储侧）；templatesDir = templates/flows 对应物（T5 门面消费）。
 * 布局分层：账本主存储在 dataDir 侧；工作区侧只落 TASK.md/AGENTS.md 引用行/.mcp.json（见 ledger.ts）。
 */
import { join } from 'node:path'

/** 注入基目录（与 T5 EngineDeps 同形——门面透传给账本） */
export interface EngineDirs {
  /** service 数据目录（~/.devzero 对应物）：tasks/ + archive/tasks/ 的宿主 */
  dataDir: string
  /** flow 模板源目录（templates/flows 对应物）——T5 门面读源表，账本不读 */
  templatesDir: string
}

/** 任务元信息（flow-state.json 的 meta 部分——状态机字段之外） */
export interface TaskMeta {
  task_id: string
  flow: string
  title: string
  workspace: string
  display_name?: string
  created_at: string
  updated_at: string
}

/** 活动任务账本目录：<dataDir>/tasks/<taskId>（flow-state.json + events.jsonl + table.snapshot.yml + handoffs/） */
export const taskDir = (dirs: EngineDirs, taskId: string): string =>
  join(dirs.dataDir, 'tasks', taskId)

/** 归档目录：<dataDir>/archive/tasks/<taskId>（占用时账本内换 .r2/.r3 代际名） */
export const archiveDir = (dirs: EngineDirs, taskId: string): string =>
  join(dirs.dataDir, 'archive', 'tasks', taskId)
