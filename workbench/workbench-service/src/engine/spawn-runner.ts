/**
 * Spawn Runner（L3 T9）——驱动器的手脚：构造派发指令文件 + 调 Launcher + 超时管理。
 * prompt 一律走文件（Windows .CMD 垫片多行 argv 截断坑①）；spawn 前置 healthz 由 service 装配层
 * 保证（service 常驻即引擎在）；超时=reject（真机 launcher 内负责 kill 进程树——Windows
 * TerminateProcess 语义，本层只感知失败）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureMcpConfig } from '@devzero/engine'
import type { Launcher, LaunchRequest } from './launcher'

export interface SpawnSpec {
  taskId: string
  workspace: string
  emp: string
  /** 派发节点（员工会话=当前节点；评审会话=闸位节点） */
  node: string
  /** 渲染后的派发指令（员工=节点 prompt；评审=评审模板） */
  promptBody: string
  /** 上下文标记（mock 协议消费 + 真机日志定位）：gate id / dispatch_id / mock 指令区 */
  gateId?: string
  dispatchId: string
  mockDirectives?: string[]
  model?: string
  effort?: string
}

export interface SpawnRunnerOptions {
  launcher: Launcher
  /** 单会话超时 ms（缺省 10min；测试注入短值） */
  timeoutMs?: number
  /** prompt 文件目录（缺省 <workspace>/.devzero/spawn/；测试可注入临时目录） */
  spawnDir?: (workspace: string) => string
}

export class SpawnRunner {
  constructor(private opts: SpawnRunnerOptions) {}

  async spawn(spec: SpawnSpec): Promise<{ code: number }> {
    // 键级自愈（🟡2）：用户/底座 CLI 中途改写 .mcp.json 丢 devzero-engine 键 → 每次派发前幂等补回
    ensureMcpConfig(spec.workspace)
    const dir = (this.opts.spawnDir ?? ((ws: string) => join(ws, '.devzero', 'spawn')))(spec.workspace)
    mkdirSync(dir, { recursive: true })
    const promptFile = join(dir, `${spec.dispatchId}-${randomUUID().slice(0, 8)}.md`)

    // 指令文件：上下文标记 + 指令正文 + mock 指令区（真机只读正文；mock 按 #mock: 行执行）
    const lines = [
      `task_id: ${spec.taskId}`,
      `node: ${spec.node}`,
      `dispatch_id: ${spec.dispatchId}`,
      `emp: ${spec.emp}`,
      ...(spec.gateId ? [`gate: ${spec.gateId}`] : []),
      '',
      spec.promptBody,
      '',
      ...(spec.mockDirectives ?? []).map((d) => `#mock:${d}`),
      '',
    ]
    writeFileSync(promptFile, lines.join('\n'), 'utf8')

    const req: LaunchRequest = {
      deploymentHint: { emp: spec.emp },
      workdir: spec.workspace,
      promptFile,
      permission: 'bypass', // 真机映射 -y/--dangerously-skip-permissions（spike §3.4 权限门）
      ...(spec.model !== undefined ? { model: spec.model } : {}),
      ...(spec.effort !== undefined ? { effort: spec.effort } : {}),
    }
    const timeoutMs = this.opts.timeoutMs ?? 10 * 60_000
    return Promise.race([
      this.opts.launcher.launch(req),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`spawn 超时（${timeoutMs}ms）: ${spec.emp}@${spec.node}`)), timeoutMs),
      ),
    ])
  }
}

/** 评审会话 prompt 模板（设计 §5.2——引擎内置非表配置） */
export function reviewPromptBody(opts: {
  workspace: string; taskId: string; gateId: string; reviewer: string; covers: string[] | undefined
}): string {
  return [
    `你是员工 ${opts.reviewer}，被派执行闸 ${opts.gateId} 评审。`,
    `读 ${opts.workspace}/.devzero/tasks/${opts.taskId}/handoffs/ 与相关产物，`,
    `按闸覆盖范围（${opts.covers?.join(', ') ?? '当前节点产物'}）给出 PASS/FAIL + issues，`,
    '调 engine_record_gate 回报，然后 engine_dispatch_done。',
    '',
  ].join('')
}
