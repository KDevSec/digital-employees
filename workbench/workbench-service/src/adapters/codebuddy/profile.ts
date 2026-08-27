/** CodeBuddy 档案（CC 同构预期；身份面 429 待复验——设计 §5.1 ⏳ / M2 清单 3） */
import type { BaseProfile } from '../contract'

export const profile: BaseProfile = {
  id: 'codebuddy', label: 'CodeBuddy', command: 'codebuddy',
  identity_anchor: 'config-domain',
  identity_file: 'CODEBUDDY.md',
  skills_dir: 'skills',
  version_min: '2.137.1', version_tested: '2.137.1',
  provides: ['agent-def', 'fs-access', 'skill-def', 'bash-exec', 'slash-command', 'subagent-dispatch'],
  auth: { kind: 'none', files: [] },
  launch: { configEnv: 'CODEBUDDY_CONFIG_DIR' },
}
