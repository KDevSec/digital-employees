/**
 * RealClaudeLauncher（I2 T4）——消费 L2 LaunchSpec（含 Task 3 stdin 字段），spawn claude CLI：
 * env 注入（CLAUDE_CONFIG_DIR=home/config + 继承 service env→认证零置备），cwd=workdir，
 * prompt 走 stdin（Windows .CMD 垫片多行 argv 截断——stdin 唯一可靠通道），超时 taskkill /T /F 树。
 * 测试形态：registry 桩（~/.devzero 不动） + commandOverride=node 跑一个假 claude .js（读 stdin 落盘 + 按文件指定退出码退出）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RealClaudeLauncher } from '../../src/engine/real-launcher'

let scratch: string
let home: string
let workdir: string
let registryFile: string
let fakeClaudeJs: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'wb-real-launcher-'))
  // 员工部署 home（含 config/CLAUDE.md，N=1 充分——真实 home 结构由 installs E2E 已覆盖）
  home = join(scratch, 'digital-staff', 'claude-code', 'sec-compliance')
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', 'CLAUDE.md'), '# 测试身份', 'utf8')
  // 工作区
  workdir = join(scratch, 'ws')
  mkdirSync(workdir, { recursive: true })
  // 注册 registry（含此 emp 装到 claude-code 的 home）
  registryFile = join(scratch, 'registry.json')
  writeFileSync(registryFile, JSON.stringify({
    registry_version: 1,
    deployments: [{
      employee_id: 'sec-compliance', spec_version: '0.1.0', base: 'claude-code', home,
      status: 'installed', identity_anchor: 'config-domain', base_version: '2.1.226',
      installed_at: new Date().toISOString(), last_launch_at: null, manifest_path: join(home, '.devzero-manifest.json'),
    }],
  }), 'utf8')
  // 假 claude 替身 node 脚本：读 stdin → fake/stdin.log；按 fake/exit-code.txt 决定退出码（缺省 0）
  fakeClaudeJs = join(scratch, 'fake-claude.js')
})

afterEach(() => { rmSync(scratch, { recursive: true, force: true }) })

/** 写假 claude 替身脚本（每次用例生成——可读 stdin/解 env/定退出码） */
function writeFakeClaude(opts: { echoArgv?: boolean; sleepMs?: number } = {}): void {
  const js = `
const fs = require('node:fs')
const sleepMs = ${opts.sleepMs ?? 0}
const stdinLogFile = ${JSON.stringify(join(scratch, 'stdin.log'))}
const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  const stdinText = Buffer.concat(chunks).toString('utf8')
  fs.writeFileSync(${JSON.stringify(join(scratch, 'stdin.log'))}, stdinText, 'utf8')
  fs.writeFileSync(${JSON.stringify(join(scratch, 'env.log'))}, JSON.stringify({
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
    cwd: process.cwd(),
    argv: process.argv,
  }), 'utf8')
  let exitCode = 0
  try { exitCode = Number(fs.readFileSync(${JSON.stringify(join(scratch, 'exit-code.txt'))}, 'utf8').trim()) } catch { exitCode = 0 }
  setTimeout(() => process.exit(exitCode), sleepMs)
})
process.stdin.on('error', () => {})
  `
  writeFileSync(fakeClaudeJs, js, 'utf8')
}

function newLauncher(opts: { timeoutMs?: number } = {}): RealClaudeLauncher {
  return new RealClaudeLauncher({
    registryFile,
    commandOverride: 'node',
    argsPrepend: [fakeClaudeJs],
    timeoutMs: opts.timeoutMs,
  })
}

describe('RealClaudeLauncher（I2 T4——消费 L2 LaunchSpec 真机 spawn）', () => {
  it('从 registry 解析 emp→home→spawn，env 注入 CLAUDE_CONFIG_DIR + cwd=workdir，prompt 走 stdin', async () => {
    writeFakeClaude()
    const prompt = '第一行\n第二行\n多行 prompt 含特殊字符 `$()&|'
    const promptFile = join(workdir, '.devzero-spawn-test.md')
    writeFileSync(promptFile, prompt, 'utf8')

    const launcher = newLauncher()
    const res = await launcher.launch({
      deploymentHint: { emp: 'sec-compliance', base: 'claude-code' },
      workdir,
      promptFile,
      permission: 'bypassPermissions',
    })

    expect(res.code).toBe(0)
    // stdin 全文送达（关键 P0c 接口）
    expect(readFileSync(join(scratch, 'stdin.log'), 'utf8')).toBe(prompt)
    // env 与 cwd 注入正确（LaunchSpec env CLAUDE_CONFIG_DIR→home/config；cwd=workdir）
    const envLog = JSON.parse(readFileSync(join(scratch, 'env.log'), 'utf8'))
    expect(envLog.CLAUDE_CONFIG_DIR).toBe(join(home, 'config'))
    expect(envLog.cwd.toLowerCase().replace(/\\/g, '/')).toBe(workdir.toLowerCase().replace(/\\/g, '/'))
  })

  it('退出码非 0 透传（底座失败 → Driver 重试/挂起兜底）', async () => {
    writeFakeClaude()
    writeFileSync(join(scratch, 'exit-code.txt'), '42', 'utf8')
    const promptFile = join(workdir, 'p.md')
    writeFileSync(promptFile, 'failure test', 'utf8')

    const res = await newLauncher().launch({
      deploymentHint: { emp: 'sec-compliance', base: 'claude-code' },
      workdir, promptFile, permission: 'bypassPermissions',
    })
    expect(res.code).toBe(42)
  })

  it('registry 无此 emp→base 部署 → 抛 NOT_INSTALLED（先装再派）', async () => {
    writeFakeClaude()
    const promptFile = join(workdir, 'p.md')
    writeFileSync(promptFile, 'x', 'utf8')

    await expect(newLauncher().launch({
      deploymentHint: { emp: 'ghost-emp', base: 'claude-code' },
      workdir, promptFile, permission: 'bypassPermissions',
    })).rejects.toThrow(/未安装|NOT_INSTALLED|部署/)
  })

  it('超时：taskkill 杀进程树（Windows TerminateProcess 语义），launch reject', async () => {
    writeFakeClaude({ sleepMs: 30_000 })   // 假 CLI 30s 才退出
    const promptFile = join(workdir, 'p.md')
    writeFileSync(promptFile, 'hang', 'utf8')

    await expect(newLauncher({ timeoutMs: 300 }).launch({
      deploymentHint: { emp: 'sec-compliance', base: 'claude-code' },
      workdir, promptFile, permission: 'bypassPermissions',
    })).rejects.toThrow(/超时|timeout/i)
  }, 10_000)

  if (process.platform === 'win32') {
    it('Windows .cmd 垫片可 spawn（M2 实锤坑：spawn shell:false 时 .cmd ENOENT，I2 必修）', async () => {
      // 用真 .cmd shim 替身（不替 node.exe）——要求 shell:true 才起得来
      writeFakeClaude()
      const shim = join(scratch, 'claude.cmd')
      // 在 `%*` 前加 `--`，让 node 把 -p 等留给 script.argv（防 node 自带 flag 拦截）
      writeFileSync(shim, `@echo off\r\nnode "${fakeClaudeJs}" -- %*\r\n`, 'utf8')

      const launcher = new RealClaudeLauncher({
        registryFile,
        commandOverride: shim,
        timeoutMs: 5000,
      })
      const promptFile = join(workdir, 'shim-test.md')
      writeFileSync(promptFile, '垫片测试多行\nprompt', 'utf8')
      const res = await launcher.launch({
        deploymentHint: { emp: 'sec-compliance', base: 'claude-code' },
        workdir, promptFile, permission: 'bypassPermissions',
      })
      expect(res.code).toBe(0)
      const stdinLog = join(scratch, 'stdin.log')
      if (!existsSync(stdinLog)) {
        throw new Error(`stdin.log 未生成（shim 未跑通 cwd=${workdir}）`)
      }
      expect(readFileSync(stdinLog, 'utf8')).toBe('垫片测试多行\nprompt')
    }, 15_000)
  }

  it('permission / model / effort 透传到 args 旗标（四层解析透传执行）', async () => {
    writeFakeClaude()
    const promptFile = join(workdir, 'p.md')
    writeFileSync(promptFile, 'test', 'utf8')

    const res = await newLauncher().launch({
      deploymentHint: { emp: 'sec-compliance', base: 'claude-code' },
      workdir, promptFile,
      permission: 'bypassPermissions', model: 'opus', effort: 'high',
    })
    expect(res.code).toBe(0)
    const envLog = JSON.parse(readFileSync(join(scratch, 'env.log'), 'utf8'))
    const argv: string[] = envLog.argv
    expect(argv.join(' ')).toContain('--dangerously-skip-permissions')   // bypassPermissions 映射
    expect(argv.join(' ')).not.toContain('--permission-mode')
    expect(argv.join(' ')).toContain('--model')
    expect(argv.join(' ')).toContain('--effort')
  })
})
