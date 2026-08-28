/** Claude Code 档案（设计 §5.1；S4 V1/V6 实证基线） */
import type { BaseProfile } from '../contract'

export const profile: BaseProfile = {
  id: 'claude-code', label: 'Claude Code', command: 'claude',
  identity_anchor: 'config-domain',
  identity_file: 'CLAUDE.md',
  skills_dir: 'skills',
  version_min: '2.1.226', version_tested: '2.1.226',
  provides: ['agent-def', 'fs-access', 'skill-def', 'bash-exec', 'slash-command', 'subagent-dispatch'],
  auth: { kind: 'symlink', files: ['.credentials.json'], envTokenKeys: ['ANTHROPIC_AUTH_TOKEN'] },
  launch: { configEnv: 'CLAUDE_CONFIG_DIR' },
}
