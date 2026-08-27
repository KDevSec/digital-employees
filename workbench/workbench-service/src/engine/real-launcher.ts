/**
 * RealClaudeLauncher（I2 T4；D-048：launch 不 spawn，进程管理归本层；I2 设计 §6）
 *
 * 消费 L2 adapter.launch() 返回的 LaunchSpec（command/args/env/cwd/stdin 均来自 L2，本层不拼命令）：
 * - env 注入 = process.env（含 ANTHROPIC_AUTH_TOKEN/BASE_URL，M2 认证零置备）∪ LaunchSpec.env（CLAUDE_CONFIG_DIR）
 * - cwd = LaunchSpec.cwd（任务工作区）
 * - prompt 走 stdin（I2 P0c：Windows .CMD 垫片多行 argv 截断——stdin 唯一可靠通道）
 * - 超时 taskkill /T /F（Windows TerminateProcess 树语义）
 *
 * 解析链：deploymentHint.emp → DeploymentRegistry.find(base, emp) → record.home（NOT_INSTALLED 若无）
 * → adapter.launch({deployment:{base,home,employee_id}, workdir, prompt, permission, model, effort}) → spawn。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createDeploymentRegistry } from '../installs/registry/registry'
import { createClaudeCodeAdapter } from '../adapters/claude-code/index'
import type { BaseId, LaunchSpec } from '../adapters/contract'
import type { Launcher, LaunchRequest } from './launcher'

export interface RealClaudeLauncherOptions {
  /** 部署台账（默认用全局 registryFile；测试可注入临时桩） */
  registryFile: string
  /** 命令覆盖（默认 profile.command='claude'；测试用 'node' + argsPrepend 跑替身脚本） */
  commandOverride?: string
  /** 旗标前缀（默认无；测试用 [`${fakeClaudeJs}`] 加载替身脚本） */
  argsPrepend?: string[]
  /** 超时毫秒（缺省 10min；测试注入短值） */
  timeoutMs?: number
}

export class RealClaudeLauncher implements Launcher {
  constructor(private opts: RealClaudeLauncherOptions) {}

  async launch(req: LaunchRequest): Promise<{ code: number }> {
    const base: BaseId = (req.deploymentHint.base ?? 'claude-code') as BaseId   // I2 选 A：claude-code 先行
    const emp = req.deploymentHint.emp
    const registry = createDeploymentRegistry(this.opts.registryFile)
    const rec = registry.find(base, emp)
    if (!rec) {
      throw new Error(`员工未部署到 ${base}：${emp}（ including 'NOT_INSTALLED'）——先装到底座再派`)
    }

    const prompt = await readFile(req.promptFile, 'utf8')
    const adapter = createClaudeCodeAdapter()
    const spec: LaunchSpec = await adapter.launch({
      deployment: { base, home: rec.home, employee_id: emp },
      workdir: req.workdir,
      prompt,
      permission: req.permission,
      model: req.model,
      effort: req.effort,
    })

    return this.spawnSpec(spec)
  }

  /** spawn LaunchSpec：env 合并 + cwd + stdin 写 prompt 全文 + 超时进程树 */
  private async spawnSpec(spec: LaunchSpec): Promise<{ code: number }> {
    const command = this.opts.commandOverride ?? spec.command
    const args = [...(this.opts.argsPrepend ?? []), ...spec.args]
    const timeoutMs = this.opts.timeoutMs ?? 10 * 60_000

    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },   // service env 为秘钥来源（M2 认证零置备）
        shell: false,
        stdio: ['pipe', 'inherit', 'inherit'],
      })
      let finished = false
      const killer = setTimeout(() => {
        if (finished) return
        finished = true
        killTree(child.pid, () => reject(new Error(`超时（${timeoutMs}ms）：${command} 未退出（Windows TerminateProcess 语义）`)))
      }, timeoutMs)

      child.on('error', (err) => {
        if (finished) return
        finished = true
        clearTimeout(killer)
        reject(err)
      })
      child.on('close', (code) => {
        if (finished) return
        finished = true
        clearTimeout(killer)
        resolve({ code: code ?? 1 })
      })

      if (spec.stdin !== undefined && child.stdin) {
        child.stdin.write(spec.stdin)
        child.stdin.end()
      } else if (child.stdin) {
        child.stdin.end()
      }
    })
  }
}

/** Windows 进程树 kill（taskkill /T /F /PID <pid>）；POSIX 退化为 SIGKILL 直接发 */
function killTree(pid: number | undefined, done: () => void): void {
  if (pid === undefined) { done(); return }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' })
    killer.on('close', () => done())
    killer.on('error', () => done())
  } else {
    try { process.kill(pid, 'SIGKILL') } catch { /* 已退出无害 */ }
    done()
  }
}
