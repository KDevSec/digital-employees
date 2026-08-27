import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeploymentRegistry } from '../src/installs/registry/registry'
import type { DeploymentRecord } from '../src/installs/registry/registry'

let registryFile: string

function makeRec(over: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    employee_id: 'dev-lite', spec_version: '0.1.0', base: 'claude-code',
    home: 'C:/tmp/home', status: 'installed',
    identity_anchor: 'config-domain', base_version: '2.1.245',
    installed_at: '2026-08-27T00:00:00Z', last_launch_at: null,
    manifest_path: 'C:/tmp/home/.devzero-manifest.json',
    ...over,
  }
}

describe('Deployment registry（~/digital-staff/registry.json 台账，设计 §3.2）', () => {
  it('upsert 新行 → find 命中；文件落盘为 {registry_version, deployments}', () => {
    registryFile = join(mkdtempSync(join(tmpdir(), 'wb-reg-')), 'registry.json')
    const reg = createDeploymentRegistry(registryFile)
    reg.upsert(makeRec())
    expect(reg.find('claude-code', 'dev-lite')?.status).toBe('installed')
    const onDisk = JSON.parse(readFileSync(registryFile, 'utf8'))
    expect(onDisk.registry_version).toBe(1)
    expect(onDisk.deployments).toHaveLength(1)
  })

  it('同 (base, employee_id) upsert = 覆盖更新（幂等键），不同 base = 两行', () => {
    const reg = createDeploymentRegistry(join(mkdtempSync(join(tmpdir(), 'wb-reg-')), 'registry.json'))
    reg.upsert(makeRec({ status: 'installing' }))
    reg.upsert(makeRec({ status: 'installed' }))
    reg.upsert(makeRec({ base: 'qoder', home: 'C:/tmp/home-q' }))
    expect(reg.list()).toHaveLength(2)
    expect(reg.find('claude-code', 'dev-lite')?.status).toBe('installed')
  })

  it('remove 后 find 为空且返回 true；不存在返回 false（幂等）', () => {
    const reg = createDeploymentRegistry(join(mkdtempSync(join(tmpdir(), 'wb-reg-')), 'registry.json'))
    reg.upsert(makeRec())
    expect(reg.remove('claude-code', 'dev-lite')).toBe(true)
    expect(reg.remove('claude-code', 'dev-lite')).toBe(false)
    expect(reg.find('claude-code', 'dev-lite')).toBeUndefined()
  })

  it('跨实例持久化：第二个实例读到第一个实例的写入（每次操作读改写）', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wb-reg-')), 'registry.json')
    createDeploymentRegistry(file).upsert(makeRec())
    expect(createDeploymentRegistry(file).find('claude-code', 'dev-lite')).toBeDefined()
  })

  it('损坏 JSON → 一等安装期错误 REGISTRY_CORRUPT（不静默吞）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-reg-'))
    registryFile = join(dir, 'registry.json')
    writeFileSync(registryFile, '{broken', 'utf8')
    expect(() => createDeploymentRegistry(registryFile).list()).toThrowError(
      expect.objectContaining({ code: 'REGISTRY_CORRUPT' }),
    )
  })
})
