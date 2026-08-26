/**
 * R1 账本路径（T4 修复版）——布局回归 D-045（设计 §7.1 / §2 裁决 #9）：
 * 活动账本在 <workspace>/.devzero/tasks/<id>/（员工底座会话 cwd 树内零成本可见，
 * 对标 1.0 .ieidev 在项目根）；完成归档搬到 <dataDir>/archive/tasks/<id>；
 * dataDir 侧 tasks-index.json 轻量索引（活动任务分散各 workspace，定位/列表之源）。
 * 全部接收注入参数，不做任何环境推断（测试传临时目录）。
 */
import { join } from 'node:path'

/** 注入基目录（与 T5 EngineDeps 同形——门面透传给账本） */
export interface EngineDirs {
  /** service 数据目录（~/.devzero 对应物）：tasks-index.json + archive/tasks/ 的宿主 */
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

/** 索引行（<dataDir>/tasks-index.json 的 tasks.<task_id>） */
export interface IndexEntry {
  workspace: string
  flow: string
  title: string
  status: string
  archived: boolean
  archive_path: string | null
  created_at: string
  updated_at: string
}

/** 活动任务账本目录：<workspace>/.devzero/tasks/<taskId>（flow-state.json + events.jsonl + table.snapshot.yml + handoffs/） */
export const taskDir = (workspace: string, taskId: string): string =>
  join(workspace, '.devzero', 'tasks', taskId)

/** 归档目录：<dataDir>/archive/tasks/<taskId>（占用时换 .r2/.r3 代际名） */
export const archiveDir = (dirs: EngineDirs, taskId: string): string =>
  join(dirs.dataDir, 'archive', 'tasks', taskId)

/** 任务索引路径：<dataDir>/tasks-index.json */
export const indexPath = (dirs: EngineDirs): string =>
  join(dirs.dataDir, 'tasks-index.json')
