/** 三底座档案汇总（静态表；plan/launch 的档案差异全部收敛于此，设计 §5） */
import type { BaseId, BaseProfile } from './contract'
import { profile as claudeCode } from './claude-code/profile'
import { profile as codebuddy } from './codebuddy/profile'
import { profile as qoder } from './qoder/profile'

export const baseProfiles: Record<BaseId, BaseProfile> = {
  'claude-code': claudeCode,
  codebuddy,
  qoder,
}

export { claudeCode, codebuddy, qoder }
