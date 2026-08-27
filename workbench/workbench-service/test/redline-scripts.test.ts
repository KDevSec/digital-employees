/**
 * 红线脚本本体测试（Task 19 / D3）：
 *
 * 覆盖：
 *  ① run-hook.cmd polyglot 包装器：CRLF 行尾断言（cmd.exe 解析需要）
 *  ② 5 规则 py × 7 模板 redlines/ 目录同构（文件集合相等）
 *  ③ 6 规则（5 红线 + deny-tool）各至少一命中（exit 2 + stderr 含拒因关键词）一放行（exit 0）
 *
 * 协议：CC hook 协议——stdin JSON `{tool_name, tool_input}`，命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
 * 1.0 先例：agents-team/hooks/run-python-hook.cmd 同态。
 *
 * 注：Windows 开发机上调 `cmd /c run-hook.cmd <rule>.py`；Unix 兼容由 run-hook.cmd 单行 bash 分支保证。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { builtinTemplates } from '../src/assets/templates.gen'

const TPL_ROOT = join(__dirname, '..', '..', 'templates')
const TEMPLATE_IDS = [
  'dev-engineer',
  'req-clarifier',
  'reviewer-expert',
  'sec-code',
  'sec-compliance',
  'sec-design',
  'sys-engineer',
] as const

const REDLINE_FILES = [
  'run-hook.cmd',
  'no-push-to-main.py',
  'no-devzero-state.py',
  'no-external-request.py',
  'no-production-access.py',
  'no-db-schema.py',
  'deny-tool.py',
] as const

/**
 * 调 run-hook.cmd 执行指定规则 py，喂 stdin JSON，返回 { exitCode, stderr, stdout }。
 * Windows: cmd /c run-hook.cmd <rule>.py  —— 1.0 polyglot 包装器协议。
 */
function runHook(tplId: string, rulePy: string, stdinJson: string): {
  exitCode: number
  stderr: string
  stdout: string
} {
  const hookDir = join(TPL_ROOT, tplId, 'hooks', 'redlines')
  // Windows: cmd /c .\run-hook.cmd <rule>.py（cmd 默拒 cwd 内命令须显式 .\ 前缀）
  // Unix: bash run-hook.cmd <rule>.py（polyglot 单行 bash 分支）
  const isWin = process.platform === 'win32'
  const cmd = isWin ? 'cmd' : 'bash'
  const args = isWin
    ? ['/c', '.\\run-hook.cmd', rulePy]
    : ['run-hook.cmd', rulePy]
  const r = spawnSync(cmd, args, {
    cwd: hookDir,
    input: stdinJson,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, PYTHONUTF8: '1' },
    shell: false,
  })
  // spawnSync 在子进程被信号杀死时 exitCode 为 null；规约为 -1 让断言失败可见
  return {
    exitCode: r.status ?? -1,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  }
}

describe('红线脚本 — ① run-hook.cmd CRLF 行尾', () => {
  it('dev-engineer/run-hook.cmd 含 \\r\\n（cmd.exe 解析需要 CRLF）', () => {
    const buf = readFileSync(join(TPL_ROOT, 'dev-engineer', 'hooks', 'redlines', 'run-hook.cmd'))
    expect(buf.includes(0x0d)).toBe(true) // 含 \r
    // 转 text 后含 \r\n
    const text = buf.toString('latin1')
    expect(text).toMatch(/\r\n/)
  })
})

describe('红线脚本 — ② 7 模板 redlines/ 同构', () => {
  it('每模板 hooks/redlines/ 目录在位且文件集合等于 REDLINE_FILES', () => {
    for (const tpl of TEMPLATE_IDS) {
      const dir = join(TPL_ROOT, tpl, 'hooks', 'redlines')
      expect(existsSync(dir)).toBe(true)
      const files = readdirSync(dir).sort()
      expect(files).toEqual([...REDLINE_FILES].sort())
    }
  })

  it('7 模板 run-hook.cmd 字节级一致（同内容拷贝）', () => {
    const base = readFileSync(join(TPL_ROOT, 'dev-engineer', 'hooks', 'redlines', 'run-hook.cmd'))
    for (const tpl of TEMPLATE_IDS) {
      if (tpl === 'dev-engineer') continue
      const other = readFileSync(join(TPL_ROOT, tpl, 'hooks', 'redlines', 'run-hook.cmd'))
      expect(other.equals(base)).toBe(true)
    }
  })

  it('7 模板每个规则 py 字节级一致（同内容拷贝）', () => {
    for (const rule of REDLINE_FILES) {
      if (rule === 'run-hook.cmd') continue
      const base = readFileSync(join(TPL_ROOT, 'dev-engineer', 'hooks', 'redlines', rule))
      for (const tpl of TEMPLATE_IDS) {
        if (tpl === 'dev-engineer') continue
        const other = readFileSync(join(TPL_ROOT, tpl, 'hooks', 'redlines', rule))
        expect(other.equals(base)).toBe(true)
      }
    }
  })
})

describe('红线脚本 — ③ 6 规则命中/放行两态', () => {
  // helper：构造 CC hook stdin JSON
  const stdin = (tool_name: string, tool_input: Record<string, unknown>) =>
    JSON.stringify({ tool_name, tool_input })

  // ── no-push-to-main ──
  it('no-push-to-main: git push origin main → exit 2 + stderr 含「main」', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin main' }),
    )
    expect(r.exitCode).toBe(2)
    expect(r.stderr.toLowerCase()).toContain('main')
  })

  it('no-push-to-main: git push origin feature/x → exit 0', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin feature/x' }),
    )
    expect(r.exitCode).toBe(0)
  })

  it('no-push-to-main: git push --force origin master → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push --force origin master' }),
    )
    expect(r.exitCode).toBe(2)
  })

  // ── I1 误报回归（feature/main-* 不应被拦） ──
  it('no-push-to-main: git push origin feature/main-login → exit 0（feature/main-* 误报回归）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin feature/main-login' }),
    )
    expect(r.exitCode).toBe(0)
  })

  it('no-push-to-main: git push origin main-login → exit 0（main-前缀分支名不拦）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin main-login' }),
    )
    expect(r.exitCode).toBe(0)
  })

  it('no-push-to-main: git push origin feature/master-fix → exit 0（master 嵌入不拦）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin feature/master-fix' }),
    )
    expect(r.exitCode).toBe(0)
  })

  // ── I1 显式 refspec 形态补强 ──
  it('no-push-to-main: git push origin HEAD:main → exit 2（HEAD:main refspec 拦）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push origin HEAD:main' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-push-to-main: git push -f origin master → exit 2（-f 短形式 force 拦）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push -f origin master' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-push-to-main: git push --force-with-lease origin main → exit 2（--force-with-lease 拦）', () => {
    const r = runHook(
      'dev-engineer',
      'no-push-to-main.py',
      stdin('Bash', { command: 'git push --force-with-lease origin main' }),
    )
    expect(r.exitCode).toBe(2)
  })

  // ── no-devzero-state ──
  it('no-devzero-state: Write file_path 含 /.devzero/ → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-devzero-state.py',
      stdin('Write', { file_path: '/home/u/.devzero/state.json' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-devzero-state: Write 普通文件 → exit 0', () => {
    const r = runHook(
      'dev-engineer',
      'no-devzero-state.py',
      stdin('Write', { file_path: '/home/u/project/src/app.ts' }),
    )
    expect(r.exitCode).toBe(0)
  })

  it('no-devzero-state: Bash command 含 \\.devzero\\ (Windows) → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-devzero-state.py',
      stdin('Bash', { command: 'type C:\\Users\\u\\.devzero\\state.json' }),
    )
    expect(r.exitCode).toBe(2)
  })

  // ── no-external-request ──
  it('no-external-request: Bash curl → exit 2', () => {
    const r = runHook(
      'sec-code',
      'no-external-request.py',
      stdin('Bash', { command: 'curl https://example.com' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-external-request: WebFetch → exit 2（V0.1 空白名单=全拒外网）', () => {
    const r = runHook(
      'sec-code',
      'no-external-request.py',
      stdin('WebFetch', { url: 'https://example.com' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-external-request: Bash ls → exit 0', () => {
    const r = runHook(
      'sec-code',
      'no-external-request.py',
      stdin('Bash', { command: 'ls -la' }),
    )
    expect(r.exitCode).toBe(0)
  })

  // ── no-production-access ──
  it('no-production-access: command 含 prod-db:3306 → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-production-access.py',
      stdin('Bash', { command: 'mysql -h prod-db:3306 -u root' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-production-access: command 含 production → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-production-access.py',
      stdin('Bash', { command: 'ssh production.example.com' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-production-access: 普通 command → exit 0', () => {
    const r = runHook(
      'dev-engineer',
      'no-production-access.py',
      stdin('Bash', { command: 'mysql -h dev-db:13306 -u root' }),
    )
    expect(r.exitCode).toBe(0)
  })

  // ── no-db-schema ──
  it('no-db-schema: ALTER TABLE 非 migration 路径 → exit 2', () => {
    const r = runHook(
      'dev-engineer',
      'no-db-schema.py',
      stdin('Bash', { command: 'psql -c "ALTER TABLE users ADD COLUMN x"' }),
    )
    expect(r.exitCode).toBe(2)
  })

  it('no-db-schema: ALTER TABLE migration 路径 → exit 0', () => {
    const r = runHook(
      'dev-engineer',
      'no-db-schema.py',
      stdin('Bash', {
        command: 'psql -f migrations/0001_add_x.sql',
        file_path: '/app/db/migrations/0001_add_x.sql',
      }),
    )
    expect(r.exitCode).toBe(0)
  })

  it('no-db-schema: SELECT → exit 0', () => {
    const r = runHook(
      'dev-engineer',
      'no-db-schema.py',
      stdin('Bash', { command: 'psql -c "SELECT * FROM users"' }),
    )
    expect(r.exitCode).toBe(0)
  })

  // ── deny-tool ──
  it('deny-tool: 任意 tool_name → exit 2 + stderr 含「禁用」', () => {
    const r = runHook(
      'dev-engineer',
      'deny-tool.py',
      stdin('Bash', { command: 'rm -rf /' }),
    )
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('禁用')
  })
})

describe('红线脚本 — ④ gen drift 守卫含 redlines/ 全部文件', () => {
  it('builtinTemplates 含每模板每规则 py（gen 已重跑）', () => {
    for (const tpl of TEMPLATE_IDS) {
      for (const f of REDLINE_FILES) {
        const key = `${tpl}/hooks/redlines/${f}`
        expect(builtinTemplates[key], `缺 gen 键：${key}`).toBeDefined()
      }
    }
  })
})
