import type { EmployeeSpec } from '../installs/spec/types'
import type { CmdRunner } from '../bases/probe'

/** adapter 契约类型真源（设计 §4；Task 1 先立 BaseId/AnchorKind，Task 2 补全） */
export type BaseId = 'claude-code' | 'codebuddy' | 'qoder'
export type AnchorKind = 'config-domain' | 'project-file' | 'launcher-flag'

export type PlacementAction = 'copy' | 'convert' | 'merge' | 'symlink'

export interface Placement {
  /** 包内相对路径（'AGENTS.md' | 'skills/<slug>' | 'hooks/hooks.json' | 凭证源等） */
  source: string
  /** home 内相对路径（'config/CLAUDE.md' | 'config/skills/<slug>' …）；回退档为 workdir 相对 */
  target: string
  action: PlacementAction
  /** 单文件 sha256（copy/convert）；merge 可空 */
  checksum?: string
}

export interface PlacementPlan {
  base: BaseId; home: string
  /** 本计划所属员工（merge 条目 _devzero 标记值 / 回滚归属判定） */
  employeeId: string
  /** 计划源 spec（convert 溯源注释 / 虚拟源物化取 connectors——Task 6 消费） */
  spec: EmployeeSpec
  /** auth 凭证源目录（各底座全局配置目录；__auth__/<f> 虚拟源物化取源用，缺省=不置备凭证） */
  authSourceDir?: string
  placements: Placement[]
}

export interface LaunchInput {
  deployment: { base: BaseId; home: string; employee_id: string }
  workdir: string
  prompt: string
  permission?: string
  model?: string
  effort?: string
}

export interface LaunchSpec {
  command: string; args: string[]; env: Record<string, string>; cwd: string
  /** prompt 文件中转产物（观测/审计；args 中同时带全文——spawn args 数组不经 shell 无截断坑） */
  promptFile?: string
}

export interface ModelInfo { id: string; label: string; tier?: string }

export interface BaseProfile {
  id: BaseId; label: string; command: string
  identity_anchor: AnchorKind
  identity_file: string
  skills_dir: string
  version_min: string; version_tested: string
  provides: string[]
  auth: { kind: 'symlink' | 'copy' | 'none'; files: string[] }
  /** ⏳ 标注项均为 M2 联调首日实测收口（设计 §12 真机清单 5） */
  launch: { configEnv?: string; configFlag?: string }
}

export interface BaseAdapter {
  readonly profile: BaseProfile
  plan(spec: EmployeeSpec, opts: { home: string; authSourceDir?: string }): PlacementPlan
  launch(input: LaunchInput): Promise<LaunchSpec>
  listModels(run?: CmdRunner): Promise<ModelInfo[]>
}
