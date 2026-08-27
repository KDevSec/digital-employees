import { describe, expect, it } from 'vitest'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'
import { createClaudeCodeAdapter } from '../src/adapters/claude-code/index'
import { createCodebuddyAdapter } from '../src/adapters/codebuddy/index'
import { createQoderAdapter } from '../src/adapters/qoder/index'
import type { BaseAdapter } from '../src/adapters/contract'

const HOME = 'C:/users/test/digital-staff/x/dev-lite'

async function spec() { return await parsePackage(fixturePackageDir()) }

function placementsOf(adapter: BaseAdapter) {
  return async () => {
    const plan = adapter.plan(await spec(), { home: HOME })
    expect(plan.base).toBe(adapter.profile.id)
    expect(plan.home).toBe(HOME)
    expect(plan.employeeId).toBe('dev-lite')
    return plan.placements
  }
}

describe('三底座 plan()（设计 §5 落位；config-domain 主路径）', () => {
  it('CC：身份 convert 到 config/CLAUDE.md + skills copy 到 config/skills/ + hooks merge 到 config/settings.json', async () => {
    const ps = await placementsOf(createClaudeCodeAdapter())()
    expect(ps).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'AGENTS.md', target: 'config/CLAUDE.md', action: 'convert' }),
      expect.objectContaining({ source: 'skills/tdd-methodology', target: 'config/skills/tdd-methodology', action: 'copy' }),
      expect.objectContaining({ source: 'hooks/hooks.json', target: 'config/settings.json', action: 'merge' }),
    ]))
  })

  it('CB：同构 CC，身份文件 CODEBUDDY.md', async () => {
    const ps = await placementsOf(createCodebuddyAdapter())()
    expect(ps.find((p) => p.action === 'convert')?.target).toBe('config/CODEBUDDY.md')
  })

  it('Qoder：同构 CC，身份文件 AGENTS.md（config 域内，D-L2-01 主路径）', async () => {
    const ps = await placementsOf(createQoderAdapter())()
    expect(ps.find((p) => p.action === 'convert')?.target).toBe('config/AGENTS.md')
  })

  it('auth 置备进计划：CC 软链 .credentials.json；CB 无；qoder 拷三件套', async () => {
    const cc = (await placementsOf(createClaudeCodeAdapter())()).find((p) => p.action === 'symlink')
    expect(cc?.target).toBe('config/.credentials.json')
    const cb = await placementsOf(createCodebuddyAdapter())()
    expect(cb.some((p) => p.action === 'symlink')).toBe(false)
    const qo = (await placementsOf(createQoderAdapter())()).filter((p) => p.action === 'symlink')
    expect(qo.map((p) => p.target)).toEqual(
      expect.arrayContaining(['config/installation_id', 'config/state.json', 'config/.auth']),
    )
  })

  it('connectors 非空 → config/.mcp.json merge 进计划（设计 §4.5；⏳ 域内位置 M2 实测核）', async () => {
    const s = await spec()
    s.connectors = [{ name: 'search', type: 'http', url: 'http://127.0.0.1:9100/mcp' }]
    const plan = createClaudeCodeAdapter().plan(s, { home: HOME })
    expect(plan.placements).toContainEqual(expect.objectContaining({ target: 'config/.mcp.json', action: 'merge' }))
  })

  it('包无 hooks/hooks.json → 无 merge 落位（hooksFile 可选）', async () => {
    const s = await spec()
    delete s.hooksFile
    const plan = createClaudeCodeAdapter().plan(s, { home: HOME })
    expect(plan.placements.some((p) => p.action === 'merge' && p.target === 'config/settings.json')).toBe(false)
  })

  it('project-file 回退档（改档案值）：身份/skills 落位 target 前缀改 workdir 相对（launch 期消费，设计 §5.4）', async () => {
    const adapter = createQoderAdapter()
    // profile 是模块级共享常量——用例内改值必须还原，防跨用例污染（adapter 各自新建但共享同一 profile 对象）
    const original = adapter.profile.identity_anchor
    adapter.profile.identity_anchor = 'project-file'
    try {
      const plan = adapter.plan(await spec(), { home: HOME })
      expect(plan.placements.find((p) => p.action === 'convert')?.target).toBe('AGENTS.md')
      expect(plan.placements.find((p) => p.action === 'copy')?.target).toBe('ds-dev-lite-tdd-methodology')
    } finally {
      adapter.profile.identity_anchor = original
    }
  })
})
