/**
 * R2 任务可变态（TaskView 去掉 task_id/flow/title/workspace/position 的可变核）。
 * R2 advance/getNextActions 与 R3 recordGate 均以此为输入输出——纯函数零 IO。
 */
export interface TaskState {
  status: 'in_progress' | 'gate_paused' | 'blocked' | 'completed' | 'aborted'
  current_node: string | null
  gate_iters: Record<string, number>
  gate_calls: number
  retries: Record<string, number>
  blocked_reason: string | null
}
