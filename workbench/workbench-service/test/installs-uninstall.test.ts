import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { baseProfiles } from '../src/adapters/index'
import type { BaseId } from '../src/adapters/contract'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'
import { installEmployee } from '../src/installs/service'
import type { InstallServiceDeps } from '../src/installs/service'
import { uninstallEmployee } from '../src/installs/uninstall/uninstall'

let deps: InstallServiceDeps
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'wb-unin-'))
  // 造齐 auth 源（安装成功前置）：CC 软链一件 .credentials.json；qoder 拷三件套（CB=none 无需源）
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
    // 探测桩按底座报实测基线版本（CB 支持区间 2.137.1+ 高于 CC/qoder——固定版本串会被版本断言误伤）
    probe: (base: BaseId) => ({ present: true, version: baseProfiles[base].version_tested }),
  }
})

describe('uninstallEmployee（设计 §8；S1 §8 条款 6 顺序）', () => {
  it('安装→卸载：config 域清空、registry 行删除、memory 迁移不销毁', async () => {
    const spec = await parsePackage(fixturePackageDir())
    installEmployee(deps, { spec, packageRoot: fixturePackageDir(), base: 'claude-code' })
    const home = join(deps.staffRoot, 'claude-code', 'dev-lite')
    mkdirSync(join(home, 'memory'), { recursive: true })
    writeFileSync(join(home, 'memory', 'notes.md'), '用户记忆', 'utf8')

    const r = uninstallEmployee(deps, { employeeId: 'dev-lite', base: 'claude-code' })
    expect(r).not.toBeNull()
    expect(existsSync(join(home, 'config'))).toBe(false)
    expect(existsSync(join(home, 'reports'))).toBe(false)
    expect(r!.memory_moved_to).toBeTruthy()
    expect(existsSync(join(r!.memory_moved_to!, 'memory', 'notes.md'))).toBe(true)   // 迁移保内容
  })

  it('未安装 → null（幂等 no-op）', () => {
    expect(uninstallEmployee(deps, { employeeId: 'nobody', base: 'qoder' })).toBeNull()
  })

  it('产物被手改 → 默认保留进 kept；force=true 强删', async () => {
    const spec = await parsePackage(fixturePackageDir())
    installEmployee(deps, { spec, packageRoot: fixturePackageDir(), base: 'codebuddy' })
    const home = join(deps.staffRoot, 'codebuddy', 'dev-lite')
    writeFileSync(join(home, 'config', 'CODEBUDDY.md'), '用户手改内容', 'utf8')   // hash 不符

    const r1 = uninstallEmployee(deps, { employeeId: 'dev-lite', base: 'codebuddy' })
    expect(r1!.kept.some((k) => k.includes('CODEBUDDY.md'))).toBe(true)

    // 重装再 force 卸载
    installEmployee(deps, { spec, packageRoot: fixturePackageDir(), base: 'codebuddy' })
    writeFileSync(join(home, 'config', 'CODEBUDDY.md'), '再次手改', 'utf8')
    const r2 = uninstallEmployee(deps, { employeeId: 'dev-lite', base: 'codebuddy', force: true })
    expect(r2!.kept).toEqual([])
  })

  it('registry 行随卸载删除（重复卸载 null）', async () => {
    const spec = await parsePackage(fixturePackageDir())
    installEmployee(deps, { spec, packageRoot: fixturePackageDir(), base: 'claude-code' })
    expect(uninstallEmployee(deps, { employeeId: 'dev-lite', base: 'claude-code' })).not.toBeNull()
    expect(uninstallEmployee(deps, { employeeId: 'dev-lite', base: 'claude-code' })).toBeNull()
  })
})
