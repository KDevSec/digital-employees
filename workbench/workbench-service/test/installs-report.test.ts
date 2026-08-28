import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { baseProfiles } from '../src/adapters/index'
import type { BaseId } from '../src/adapters/contract'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'
import { installEmployee } from '../src/installs/service'
import { listReports } from '../src/installs/report'

let deps: { registryFile: string; staffRoot: string; authSourceDirs: Record<BaseId, string> }

beforeEach(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'wb-svc-'))
  // 造齐三个底座的 auth 源（CC 软链一件 / qoder 拷三件套；CB=none 无需源）——
  // 用例 1 需 CC 源在场；用例 3 再单独删空 qoder 源（plan 测试注记）
  const userCc = join(scratch, 'user-cc')
  mkdirSync(userCc, { recursive: true })
  writeFileSync(join(userCc, '.credentials.json'), '{}', 'utf8')
  const userQoder = join(scratch, 'user-qoder')
  mkdirSync(userQoder, { recursive: true })
  for (const f of ['installation_id', 'state.json', '.auth']) {
    writeFileSync(join(userQoder, f), '{}', 'utf8')
  }
  deps = {
    registryFile: join(scratch, 'registry.json'),
    staffRoot: join(scratch, 'digital-staff'),
    authSourceDirs: { 'claude-code': userCc, codebuddy: '', qoder: userQoder },
  }
})

/** 探测桩：按底座报告实测基线版本（CB 支持区间 2.137.1+ 高于 CC/qoder——单一共享版本串会被版本断言误伤） */
const probe = (base: BaseId) => ({ present: true, version: baseProfiles[base].version_tested })

describe('installEmployee 服务编排（设计 §4.1 adapt 语义 + §7 报告）', () => {
  it('成功安装产出报告：scope.type=deployment + 落盘 home/reports/ + registry 行齐备', async () => {
    const report = installEmployee(
      { ...deps, probe },
      { spec: await parsePackage(fixturePackageDir()), packageRoot: fixturePackageDir(), base: 'claude-code' },
    )
    expect(report.result).toBe('success')
    expect(report.scope.type).toBe('deployment')
    expect(report.employee_id).toBe('dev-lite')
    const home = join(deps.staffRoot, 'claude-code', 'dev-lite')
    const reports = listReports(home)
    expect(reports).toHaveLength(1)
    expect(reports[0].placements.some((p) => p.target === 'config/CLAUDE.md')).toBe(true)
  })

  it('negotiate 失败（底座不在场）→ failed 报告含一等错误对象（B-8），无 home 落盘', async () => {
    const report = installEmployee(
      { ...deps, probe: () => ({ present: false, version: null }) },
      { spec: await parsePackage(fixturePackageDir()), packageRoot: fixturePackageDir(), base: 'qoder' },
    )
    expect(report.result).toBe('failed')
    expect(report.error?.code).toBe('BASE_NOT_PRESENT')
  })

  it('auth 源缺失 → rolled-back/failed 含 INSTALL_AUTH_SOURCE_MISSING（一等错误）', async () => {
    rmSync(deps.authSourceDirs.qoder, { recursive: true, force: true })   // qoder=copy 三件套，源目录空
    const report = installEmployee(
      { ...deps, probe },
      { spec: await parsePackage(fixturePackageDir()), packageRoot: fixturePackageDir(), base: 'qoder' },
    )
    expect(['failed', 'rolled-back']).toContain(report.result)
    expect(report.error?.code).toBe('INSTALL_AUTH_SOURCE_MISSING')
  })

  it('报告持久化在 home 内（多版本全量保留——设计 §7 存储注记）', async () => {
    const spec = await parsePackage(fixturePackageDir())
    installEmployee({ ...deps, probe }, { spec, packageRoot: fixturePackageDir(), base: 'codebuddy' })
    installEmployee({ ...deps, probe }, { spec, packageRoot: fixturePackageDir(), base: 'codebuddy' })  // unchanged 也留报告
    const home = join(deps.staffRoot, 'codebuddy', 'dev-lite')
    expect(listReports(home).length).toBeGreaterThanOrEqual(2)
  })

  it('env-token 认证降级时，报告 placements 视图 = 执行 placements（不再含 __auth__ 落位）', async () => {
    // 场景：CC 机器，.credentials.json 缺失（空 auth 源）+ env 有 ANTHROPIC_AUTH_TOKEN → 执行 plan 不发 auth 落位
    // Bug 现状：service.ts 用 {home}（无 authSourceDir）重算 plan 填报告——走另一条路，视图/执行脱钩；
    // 本测试强制视图 = 执行（同一调用入参）。
    const emptyAuthDir = join(deps.staffRoot, 'empty-auth')
    mkdirSync(emptyAuthDir, { recursive: true })   // 无 .credentials.json
    process.env.ANTHROPIC_AUTH_TOKEN = 'wb-test-token'
    try {
      const report = installEmployee(
        { ...deps, authSourceDirs: { ...deps.authSourceDirs, 'claude-code': emptyAuthDir }, probe },
        { spec: await parsePackage(fixturePackageDir()), packageRoot: fixturePackageDir(), base: 'claude-code' },
      )
      expect(report.result).toBe('success')
      // 视图必须反映执行：跳过了 __auth__ symlink 落位（env-token 降级生效）
      expect(report.placements.some((p) => p.target === 'config/.credentials.json')).toBe(false)
      expect(report.placements.some((p) => p.target === 'config/CLAUDE.md')).toBe(true)
    } finally {
      delete process.env.ANTHROPIC_AUTH_TOKEN
    }
  })
})
