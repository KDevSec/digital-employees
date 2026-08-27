import { buildLaunchSpec } from '../../../src/adapters/common/launch'
import type { BaseProfile } from '../../../src/adapters/contract'
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile: BaseProfile = {
  id: 'claude-code', label: 'Claude Code', command: 'claude',
  identity_anchor: 'config-domain', identity_file: 'CLAUDE.md', skills_dir: 'skills',
  version_min: '2.1.226', version_tested: '2.1.226',
  provides: [],
  auth: { kind: 'symlink', files: ['.credentials.json'] },
  launch: { configEnv: 'CLAUDE_CONFIG_DIR' },
}

describe('buildLaunchSpec prompt 走 stdin（M2 实锤 Windows .CMD 垫片多行 argv 截断）', () => {
  it('prompt 多行全文注入 stdin 字段，args 替换为 `-p -` 占位', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'wb-launch-'))
    const prompt = '多行\nprompt\n正文\n带特殊字符：`$()&|'
    const spec = await buildLaunchSpec(profile, {
      deployment: { base: 'claude-code', home: '/tmp/home', employee_id: 'e1' },
      workdir, prompt,
    })
    expect(spec.stdin).toBe(prompt)
    // args 里出现 `-p -`（stdin 占位），不再压全文
    const idx = spec.args.indexOf('-p')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(spec.args[idx + 1]).toBe('-')
    expect(spec.args).not.toContain(prompt)
  })

  it('promptFile 仍写盘用作观测/审计', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'wb-launch-'))
    const prompt = 'observability\nfile'
    const spec = await buildLaunchSpec(profile, {
      deployment: { base: 'claude-code', home: '/tmp/home', employee_id: 'e1' },
      workdir, prompt,
    })
    expect(spec.promptFile).toBeTruthy()
    expect(spec.promptFile).toContain(workdir)
  })

  it('permission/model/effort 旗标遵循 -p - 之后顺序不受 stdin 影响', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'wb-launch-'))
    const spec = await buildLaunchSpec(profile, {
      deployment: { base: 'claude-code', home: '/tmp/home', employee_id: 'e1' },
      workdir, prompt: 'x',
      permission: 'bypass', model: 'opus', effort: 'high',
    })
    expect(spec.args).toEqual(expect.arrayContaining(['-p', '-', '--permission-mode', 'bypass', '--model', 'opus', '--effort', 'high']))
    expect(spec.stdin).toBe('x')
  })
})
