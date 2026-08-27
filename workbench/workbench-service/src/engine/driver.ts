/**
 * 确定性驱动器（L3 T9，D-041）——事件订阅 → 查表决策 → 派发/收尾。无状态（全部决策从
 * 表快照+任务状态纯派生，事件处理幂等）；崩溃恢复 = 重启后重新订阅、从当前状态续推。
 *
 * 事件循环（设计 §5.1）：
 *   run.created    → 查表首节点 → action(emp) 派员工会话
 *   dispatch.done  → 查表推进：action(下段 emp) 派员工 / gate(reviewer) 派评审会话 /
 *                    terminal → completeTask；gate_paused（人工闸停靠）不派——等人放行
 *   gate(PASS,human:*) → 人工放行后 → 同 dispatch.done 查表续派
 *   spawn 失败/超时 → 重试 1 次 → 仍失败：任务挂起（驱动器侧停派 + lastError 记录——
 *                    引擎无 setBlocked 操作，任务状态保持 in_progress 停在节点，L0 人接管
 *                    或重启驱动器天然重试；执行期裁决 D-050 占位）
 *
 * 员工段内推进/gate 回报由员工会话自己经 MCP 报（dispatch.done 即段结束信号）；
 * FAIL reflow 的重派由 dispatch.done 路径天然覆盖（当前节点已是 on_reflow 目标 action）。
 */
import type { Engine } from '@devzero/engine'
import { SpawnRunner, reviewPromptBody } from './spawn-runner'

export interface DriverOptions {
  /** spawn 失败重试次数（缺省 1） */
  retries?: number
  /** mock 指令注入（测试控员工行为：advance/gate/dispatch_done 等）；缺省=空（真机形态：员工自由行动） */
  mockDirectivesFor?: (emp: string, node: string, gateId?: string) => string[]
}

interface SuspendedTask { reason: string }

export class Driver {
  private off: (() => void) | null = null
  private suspended = new Map<string, SuspendedTask>()
  /** 每任务派发历史（测试断言派发序列；真机=可观测位） */
  readonly dispatchLog: { task_id: string; emp: string; node: string; gate?: string }[] = []

  constructor(
    private engine: Engine,
    private runner: SpawnRunner,
    private opts: DriverOptions = {},
  ) {}

  start(): void {
    if (this.off) return
    this.off = this.engine.onEvent((e) => void this.onEvent(e))
  }

  stop(): void {
    this.off?.()
    this.off = null
  }

  /** 挂起任务与原因（看板黄条/日志消费位） */
  suspendedTasks(): Map<string, SuspendedTask> {
    return new Map(this.suspended)
  }

  private async onEvent(e: { type: string; trace_id: string; phase?: string; gate?: string; verdict?: string }): Promise<void> {
    // 挂起任务不再消费派发类事件（人工处理窗口）
    if (this.suspended.has(e.trace_id)) return
    try {
      if (e.type === 'run.created') {
        await this.advanceLoop(e.trace_id)
      } else if (e.type === 'dispatch' && e.phase === 'done') {
        await this.advanceLoop(e.trace_id)
      } else if (e.type === 'gate' && e.gate?.startsWith('human:') && e.verdict === 'PASS') {
        await this.advanceLoop(e.trace_id) // 人工放行后续派
      }
    } catch (err) {
      // 驱动器级异常（completeTask 失败等）——记挂起不崩溃
      this.suspended.set(e.trace_id, { reason: `driver error: ${(err as Error).message}` })
    }
  }

  /** 查表决策当前该派谁/该不该收尾（幂等——同一状态重复调用同一决策） */
  private async advanceLoop(taskId: string): Promise<void> {
    if (this.suspended.has(taskId)) return
    const ns = this.engine.nextStep(taskId)
    if (ns.is_blocked || ns.current_node === null) return
    if (ns.node_kind === 'terminal') {
      this.engine.completeTask(taskId, 'completed')
      return
    }
    // 人工闸停靠 = 等人（对话式放行），驱动器不 spawn
    const task = this.engine.getTask(taskId)
    if (task.status === 'gate_paused') return

    if (ns.node_kind === 'action' && ns.emp) {
      await this.dispatchWithRetry(taskId, {
        taskId, workspace: task.workspace, emp: ns.emp, node: ns.current_node,
        promptBody: ns.prompt ?? `执行节点 ${ns.node_name ?? ns.current_node}`,
        dispatchId: '', mock: this.opts.mockDirectivesFor?.(ns.emp, ns.current_node) ?? [],
      })
    } else if (ns.node_kind === 'gate' && ns.gate_spec) {
      await this.dispatchWithRetry(taskId, {
        taskId, workspace: task.workspace, emp: ns.gate_spec.reviewer, node: ns.current_node,
        promptBody: reviewPromptBody({
          workspace: task.workspace, taskId, gateId: ns.gate_spec.gate,
          reviewer: ns.gate_spec.reviewer, covers: ns.gate_spec.covers,
        }),
        gateId: ns.gate_spec.gate, dispatchId: '',
        mock: this.opts.mockDirectivesFor?.(ns.gate_spec.reviewer, ns.current_node, ns.gate_spec.gate) ?? [],
      })
    }
  }

  private async dispatchWithRetry(taskId: string, p: {
    taskId: string; workspace: string; emp: string; node: string
    promptBody: string; gateId?: string; dispatchId: string; mock: string[]
  }): Promise<void> {
    const { dispatch_id } = this.engine.dispatchStart(taskId, { emp: p.emp, node: p.node })
    this.dispatchLog.push({ task_id: taskId, emp: p.emp, node: p.node, ...(p.gateId ? { gate: p.gateId } : {}) })
    const retries = this.opts.retries ?? 1
    let lastErr: unknown = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { code } = await this.runner.spawn({
          taskId: p.taskId, workspace: p.workspace, emp: p.emp, node: p.node,
          promptBody: p.promptBody, gateId: p.gateId, dispatchId: dispatch_id,
          mockDirectives: p.mock,
        })
        if (code === 0) return
        lastErr = new Error(`spawn 非零退出码 ${code}（${p.emp}@${p.node}）`)
      } catch (err) {
        lastErr = err
      }
    }
    // 重试耗尽：挂起（驱动器侧停派；任务状态保持——引擎无 setBlocked，D-050 占位语义）
    this.suspended.set(taskId, { reason: `spawn 失败（已重试 ${retries} 次）: ${(lastErr as Error)?.message ?? String(lastErr)}` })
  }
}
