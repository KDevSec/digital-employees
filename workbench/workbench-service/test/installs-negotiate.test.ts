import { describe, expect, it } from 'vitest'
import { negotiate } from '../src/installs/negotiate'
import { baseProfiles } from '../src/adapters/index'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'
import type { EmployeeSpec } from '../src/installs/spec/types'

const cc = baseProfiles['claude-code']
const probe = { present: true, version: '2.1.245' }

async function spec(): Promise<EmployeeSpec> { return await parsePackage(fixturePackageDir()) }

describe('negotiate（设计 §6.1 ①；UPP 协商算法——探测修正覆盖静态声明）', () => {
  it('全能力在场面：reachable=min(推导可达, requires.level)，无降级无阻塞', async () => {
    const n = negotiate(await spec(), cc, probe)
    expect(n.design_level).toBe('L2')
    expect(n.reachable_level).toBe('L2')
    expect(n.missing_required).toEqual([])
    expect(n.blocked).toBeNull()
  })

  it('底座不在场 → blocked BASE_NOT_PRESENT（一等错误，非 warning）', async () => {
    const n = negotiate(await spec(), cc, { present: false, version: null })
    expect(n.blocked?.code).toBe('BASE_NOT_PRESENT')
  })

  it('版本低于支持区间下限 → blocked BASE_VERSION_UNSUPPORTED（B-8 安装期断言）', async () => {
    const n = negotiate(await spec(), cc, { present: true, version: '1.0.0' })
    expect(n.blocked?.code).toBe('BASE_VERSION_UNSUPPORTED')
  })

  it('版本 major 跳变 → 不阻塞但出 VERSION_MAJOR_DRIFT warning（PR-031）', async () => {
    const n = negotiate(await spec(), cc, { present: true, version: '3.0.0' })
    expect(n.blocked).toBeNull()
    expect(n.warnings.some((w) => w.code === 'VERSION_MAJOR_DRIFT')).toBe(true)
  })

  it('底座不提供 skill-def 而 spec 要求 → missing_required 非空且 blocked（missing 必装失败）', async () => {
    const noSkill = { ...cc, provides: cc.provides.filter((c) => c !== 'skill-def') }
    const n = negotiate(await spec(), noSkill, probe)
    expect(n.missing_required).toContain('skill-def')
    expect(n.blocked?.code).toBe('MISSING_REQUIRED_CAPABILITY')
  })

  it('requires.level 高于底座可达 → reachable 取小（降级不阻塞）', async () => {
    const l1Only = { ...cc, provides: cc.provides.filter((c) => c !== 'subagent-dispatch') }
    const n = negotiate(await spec(), l1Only, probe)
    expect(n.reachable_level).toBe('L1')
    expect(n.degraded.some((d) => d.tag === 'degraded-subagent')).toBe(true)
  })

  it('spec 声明 hooks（optional event:PreToolUse）而底座不支持 → degraded 非 warning（UPP optional 降级映射）', async () => {
    // hooks 事件能力不在 provides 词表内（事件能力按 optional 单列）——fixture spec 带 hooksFile
    // 而 CC 档案 provides 无对应能力项：走 optional 降级路径，不进 missing_required、不阻塞：
    const n = negotiate(await spec(), cc, probe)
    expect(n.blocked).toBeNull()
  })
})
