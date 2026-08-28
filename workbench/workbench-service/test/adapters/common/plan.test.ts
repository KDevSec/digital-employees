import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPlan } from '../../../src/adapters/common/plan'
import { profile } from '../../../src/adapters/claude-code/profile'
import type { EmployeeSpec } from '../../../src/installs/spec/types'

/** 内联 EmployeeSpec（字段对齐 src/installs/spec/types.ts 八类） */
const spec: EmployeeSpec = {
  id: 'dev-lite',
  display: 'dev-lite',
  version: '0.1.0',
  instructions: '# dev-lite\n',
  skills: [],
  requires: { level: 'L2', capabilities: [] },
  connectors: [],
  tier: 'default',
}

const HOME = '/tmp/home'

function authPlacements(authSourceDir?: string) {
  const plan = buildPlan(profile, spec, { home: HOME, authSourceDir })
  return plan.placements.filter((p) => p.source.startsWith('__auth__/'))
}

describe('buildPlan auth 落位（设计 §5.1 auth 分档；M2 实锤本机 CC env-token 形态无 .credentials.json）', () => {
  it('authSourceDir 提供但源文件不存在 → 跳过 __auth__/ 落位（env-token 零置备降级）', () => {
    const prev = process.env.ANTHROPIC_AUTH_TOKEN
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    try {
      const dir = mkdtempSync(join(tmpdir(), 'plan-auth-missing-'))
      // 目录为空：.credentials.json 不存在
      expect(existsSync(join(dir, '.credentials.json'))).toBe(false)
      expect(authPlacements(dir)).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
      else process.env.ANTHROPIC_AUTH_TOKEN = prev
    }
  })

  it('authSourceDir 提供且源文件存在 → __auth__/.credentials.json 落位保留（1.0 凭证文件模式）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-auth-present-'))
    writeFileSync(join(dir, '.credentials.json'), '{}')
    expect(authPlacements(dir)).toEqual([
      expect.objectContaining({ source: '__auth__/.credentials.json', target: 'config/.credentials.json', action: 'symlink' }),
    ])
  })

  it('authSourceDir 未提供 → 落位照常产出（executor 报更清晰的 authSourceDir 缺失）', () => {
    expect(authPlacements(undefined)).toEqual([
      expect.objectContaining({ source: '__auth__/.credentials.json', target: 'config/.credentials.json', action: 'symlink' }),
    ])
  })
})
