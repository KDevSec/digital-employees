/**
 * Launcher 契约（L3 T9）——spawn runner 对「起一次员工/评审底座会话」的抽象。
 * 真机实现（CLAUDE_CONFIG_DIR + cwd + -p + 权限放行 + Windows 进程树管理）在 I2 接 L2 adapter；
 * 本任务交付 MockLauncher——按 prompt 文件尾部的 `#mock:` 指令协议模拟员工回报
 * （读指令 → 直调 Engine 操作 → 模拟会话退出码），使驱动器全流程可纯测试内跑通。
 */
import type { Engine } from '@devzero/engine'
import { readFileSync } from 'node:fs'

/** 一次会话派发请求（S4 launch 契约子集——runner 负责写 promptFile 并传绝对路径） */
export interface LaunchRequest {
  /** 员工身份提示（真机=CLAUDE_CONFIG_DIR 解析依据；mock=记录用） */
  deploymentHint: { emp: string; base?: string }
  /** 会话 cwd（任务工作区） */
  workdir: string
  /** 派发指令文件（绝对路径，UTF-8 文本）——不进 argv（Windows .CMD 垫片截断坑①） */
  promptFile: string
  /** 权限模式（真机 -y 等预配放行——spike §3.4） */
  permission: string
  /** 模型/努力档位（四层解析结果透传；adapter 翻译底座旗标） */
  model?: string
  effort?: string
}

export interface Launcher {
  launch(req: LaunchRequest): Promise<{ code: number }>
}

// ---------- Mock 指令协议 ----------
// prompt 文件可含多行 `#mock:<cmd>`（真实 prompt 与模拟指令共存——模拟指令即「员工会话将做的事」）：
//   #mock:advance:<to>            员工自报推进
//   #mock:gate:<verdict>          评审会话回报 verdict（reviewer 身份取 deploymentHint.emp）
//   #mock:handoff:<node>:<summary> 写交接
//   #mock:dispatch_done           段结束回报（actor=emp）
//   #mock:confirm:<approve|reject> 人工放行（测试驱动）
//   #mock:sleep:<ms>              模拟耗时（测超时）
//   #mock:exit:<code>             以指定退出码结束（默认 0）
//   #mock:fail                    launch 直接抛错（测 spawn 失败路径）

export class MockLauncher implements Launcher {
  /** 收到的全部请求（测试断言 prompt 内容/顺序） */
  readonly requests: LaunchRequest[] = []

  constructor(private engine: Engine, private opts: { hook?: (req: LaunchRequest) => void } = {}) {}

  async launch(req: LaunchRequest): Promise<{ code: number }> {
    this.requests.push(req)
    this.opts.hook?.(req)
    const prompt = readFileSync(req.promptFile, 'utf8')
    const cmds = prompt.split('\n').filter((l) => l.trim().startsWith('#mock:')).map((l) => l.trim().slice('#mock:'.length))
    let exitCode = 0
    const { task_id } = extractTaskId(prompt)
    for (const cmd of cmds) {
      if (cmd.startsWith('advance:')) {
        this.engine.advance(task_id, cmd.slice('advance:'.length), { actor: req.deploymentHint.emp })
      } else if (cmd.startsWith('gate:')) {
        this.engine.recordGate(task_id, {
          gate: extractGateId(prompt) ?? 'g', verdict: cmd.slice('gate:'.length), by: req.deploymentHint.emp,
        })
      } else if (cmd.startsWith('handoff:')) {
        const rest = cmd.slice('handoff:'.length)
        const node = rest.slice(0, rest.indexOf(':'))
        const summary = rest.slice(rest.indexOf(':') + 1)
        this.engine.handoffWrite(task_id, { emp: req.deploymentHint.emp, node, summary })
      } else if (cmd === 'dispatch_done') {
        this.engine.dispatchDone(task_id, { emp: req.deploymentHint.emp, dispatch_id: extractDispatchId(prompt) ?? 'd-1' })
      } else if (cmd.startsWith('confirm:')) {
        this.engine.confirmGate(task_id, {
          node: extractNodeId(prompt) ?? '', verdict: cmd.slice('confirm:'.length) as 'approve' | 'reject',
        })
      } else if (cmd.startsWith('sleep:')) {
        await new Promise((r) => setTimeout(r, Number(cmd.slice('sleep:'.length))))
      } else if (cmd.startsWith('exit:')) {
        exitCode = Number(cmd.slice('exit:'.length))
      } else if (cmd === 'fail') {
        throw new Error('mock launch 失败（指令模拟）')
      }
    }
    return { code: exitCode }
  }
}

// mock prompt 里的上下文标记提取（driver 构造 prompt 时写入，见 spawn-runner）
function extractTaskId(prompt: string): { task_id: string } {
  const m = prompt.match(/task_id:\s*(t-[a-z0-9]+)/)
  return m ? { task_id: m[1] } : { task_id: '' }
}
function extractGateId(prompt: string): string | null {
  const m = prompt.match(/gate:\s*(g-[a-z0-9-]+)/)
  return m ? m[1] : null
}
function extractNodeId(prompt: string): string | null {
  const m = prompt.match(/node:\s*([a-z0-9-]+)/)
  return m ? m[1] : null
}
function extractDispatchId(prompt: string): string | null {
  const m = prompt.match(/dispatch_id:\s*(d-\d+)/)
  return m ? m[1] : null
}
