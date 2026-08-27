/** Qoder 档案（config-domain 主路径 D-L2-01；project-file 回退档改本档案值即可，零代码） */
import type { BaseProfile } from '../contract'

export const profile: BaseProfile = {
  id: 'qoder', label: 'Qoder', command: 'qodercli',
  identity_anchor: 'config-domain',
  identity_file: 'AGENTS.md',
  skills_dir: 'skills',
  version_min: '1.1.26', version_tested: '1.1.26',
  provides: ['agent-def', 'fs-access', 'skill-def', 'bash-exec', 'slash-command', 'subagent-dispatch'],
  auth: { kind: 'copy', files: ['installation_id', 'state.json', '.auth'] },
  launch: { configFlag: '--config-dir' },
}
