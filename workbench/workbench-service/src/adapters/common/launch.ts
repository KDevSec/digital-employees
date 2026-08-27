/**
 * LaunchSpec 构造（设计 §4.3）：纯构造值（表驱动可测），进程管理归 L3 spawn runner（D-048 分工）。
 * - config-domain 档：CC/CB 用 env 注入，Qoder 用 --config-dir 旗标；
 * - project-file 回退档：薄壳身份落 workdir（覆盖式——互斥单值天然满足）；
 * - prompt 双通道：args 带全文（spawn args 数组不经 shell，多行安全）+ .devzero/prompt-<ts>.md 落盘（观测）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseProfile, LaunchInput, LaunchSpec } from '../contract'
import { InstallError } from '../../installs/errors'
import { provenanceComment } from './plan'

export async function buildLaunchSpec(profile: BaseProfile, input: LaunchInput): Promise<LaunchSpec> {
  const env: Record<string, string> = {}
  const args: string[] = []
  const fallback = profile.identity_anchor === 'project-file'

  if (!fallback) {
    const configDir = join(input.deployment.home, 'config')
    if (profile.launch.configEnv) env[profile.launch.configEnv] = configDir
    if (profile.launch.configFlag) args.push(profile.launch.configFlag, configDir)
  } else {
    writeFallbackIdentity(profile, input)
  }

  args.push('-p', input.prompt)
  if (input.permission) args.push('--permission-mode', input.permission)
  if (input.model) args.push('--model', input.model)
  if (input.effort) args.push('--effort', input.effort)   // ⏳ 支持面 M2 清单 5 收口（B-Q9）

  const promptFile = writePromptFile(input.workdir, input.prompt)

  return { command: profile.command, args, env, cwd: input.workdir, promptFile }
}

function writePromptFile(workdir: string, prompt: string): string {
  const dir = join(workdir, '.devzero')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `prompt-${Date.now()}.md`)
  writeFileSync(file, prompt, 'utf8')
  return file
}

/**
 * 回退档薄壳：workdir/AGENTS.md 溯源注释 + @import 指向根内身份全文（S1 V-X3：引用目标必须在 scope 根内）。
 * 身份全文从 home/config/<identity_file>（adapt 产物）拷入 workdir 根内——E2 实证根外 import 被门控；
 * 源缺失 = 未安装 → NOT_INSTALLED 一等错误（B-8；LaunchInput 无 version 字段，溯源注释按 @latest）。
 * 注：skills 前缀落位属 adapt/plan 回退档口径（设计 §5.4），launch 只管身份注入。
 */
function writeFallbackIdentity(profile: BaseProfile, input: LaunchInput): void {
  const source = join(input.deployment.home, 'config', profile.identity_file)
  if (!existsSync(source)) {
    throw new InstallError({
      code: 'NOT_INSTALLED',
      message: `回退档身份源缺失：${source}（员工身份 adapt 产物不存在）`,
      phase: 'launch',
      recoverable: false,
      hint: '先安装该员工到此底座',
    })
  }
  const id = input.deployment.employee_id
  const shell = `${provenanceComment(id, 'latest')}@import ./ds-${id}-identity.md\n`
  writeFileSync(join(input.workdir, 'AGENTS.md'), shell, 'utf8')
  // 身份全文随薄壳落根内（@import 引用目标；拷贝源 = adapt 产物 config/<identity_file>）
  writeFileSync(join(input.workdir, `ds-${id}-identity.md`), readFileSync(source, 'utf8'), 'utf8')
}
