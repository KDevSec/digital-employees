/**
 * 员工包解析（fixture 实现）。
 * ⚠️ 契约切换点：@devzero/shared-protocol 合入 main 后，本文件改为薄封装
 *   （yaml parse → manifestSchema.safeParse → deriveRequires），对外签名不变。
 * 当前 capabilities 推导 = shared-protocol §2.3 派生表的内联最小版（不自建词表，
 * 词表与 negotiator 消费面同源，PR-008 根治）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { InstallError } from '../errors'
import type { ConnectorRef, EmployeeSpec, SkillEntryLite } from './types'

export function fixturePackageDir(): string {
  // import.meta.dir 为 Bun 专有（vitest/Vite transform 下为 undefined）——用标准 import.meta.url 推导
  return join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/packages/dev-lite')
}

interface FixtureManifest {
  id: string; display: string; version: string
  requires: { level: 'L0' | 'L1' | 'L2' }
  skills: SkillEntryLite[]
  connectors: ConnectorRef[]
  constraints: { tier: string }
  orchestration?: { node_table: string }
}

/** capabilities 派生（shared-protocol derive.ts 派生表内联版） */
function deriveCapabilities(m: FixtureManifest): string[] {
  const caps = ['agent-def', 'fs-access']
  if (m.skills.length > 0) caps.push('skill-def')
  if (m.orchestration) caps.push('bash-exec', 'slash-command', 'subagent-dispatch')
  return caps
}

export async function parsePackage(packageRoot: string): Promise<EmployeeSpec> {
  const manifestPath = join(packageRoot, 'manifest.yml')
  if (!existsSync(manifestPath)) {
    throw new InstallError({ code: 'INSTALL_MISSING_FILE', message: `员工包缺 manifest.yml：${packageRoot}`, phase: 'parse', recoverable: false, hint: '检查员工包目录是否完整' })
  }
  const m = parseYaml(readFileSync(manifestPath, 'utf8')) as FixtureManifest

  const agentsPath = join(packageRoot, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    throw new InstallError({ code: 'INSTALL_MISSING_FILE', message: `员工包缺 AGENTS.md：${packageRoot}`, phase: 'parse', recoverable: false, hint: 'E-12 管线应渲染 AGENTS.md' })
  }
  const instructions = readFileSync(agentsPath, 'utf8')

  const hooksRel = 'hooks/hooks.json'
  const hooksFile = existsSync(join(packageRoot, hooksRel)) ? hooksRel : undefined

  return {
    id: m.id, display: m.display, version: m.version,
    instructions,
    skills: m.skills ?? [],
    requires: { level: m.requires?.level ?? 'L0', capabilities: deriveCapabilities(m) },
    connectors: m.connectors ?? [],
    tier: m.constraints?.tier ?? '编码档',
    hooksFile,
  }
}
