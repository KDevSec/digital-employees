/**
 * Deployment 台账（设计 §3.2）：~/digital-staff/registry.json。
 * - 同步读改写（安装/卸载/launch 均低频操作，无并发锁需求——单实例服务 D-020）；
 * - 损坏文件抛 InstallError（一等错误，不静默重建——重建会丢部署事实）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AnchorKind, BaseId } from '../../adapters/contract'
import { InstallError } from '../errors'

export type DeploymentStatus = 'installing' | 'installed' | 'upgrading' | 'broken' | 'uninstalling'

export interface DeploymentRecord {
  employee_id: string; spec_version: string; base: BaseId
  home: string; status: DeploymentStatus
  identity_anchor: AnchorKind; base_version: string
  installed_at: string; last_launch_at: string | null
  manifest_path: string
}

export interface DeploymentRegistry {
  list(): DeploymentRecord[]
  find(base: BaseId, employeeId: string): DeploymentRecord | undefined
  upsert(rec: DeploymentRecord): void
  remove(base: BaseId, employeeId: string): boolean
}

interface RegistryFile { registry_version: 1; deployments: DeploymentRecord[] }

function load(file: string): RegistryFile {
  if (!existsSync(file)) return { registry_version: 1, deployments: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RegistryFile
    if (parsed.registry_version !== 1 || !Array.isArray(parsed.deployments)) throw new Error('shape')
    return parsed
  } catch {
    throw new InstallError({
      code: 'REGISTRY_CORRUPT', message: `registry.json 损坏：${file}`, phase: 'execute',
      recoverable: false, hint: '手工检查文件或删除后重装全部员工（安装可幂等重建）',
    })
  }
}

function atomicWrite(file: string, data: RegistryFile): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  if (existsSync(file)) unlinkSync(file)            // Windows：rename 到已存在目标会抛
  renameSync(tmp, file)
}

export function createDeploymentRegistry(registryFile: string): DeploymentRegistry {
  const key = (b: BaseId, id: string) => `${b}:${id}`
  return {
    list() { return load(registryFile).deployments },
    find(base, employeeId) {
      return load(registryFile).deployments.find((d) => key(d.base, d.employee_id) === key(base, employeeId))
    },
    upsert(rec) {
      const data = load(registryFile)
      const i = data.deployments.findIndex((d) => key(d.base, d.employee_id) === key(rec.base, rec.employee_id))
      if (i >= 0) data.deployments[i] = rec
      else data.deployments.push(rec)
      atomicWrite(registryFile, data)
    },
    remove(base, employeeId) {
      const data = load(registryFile)
      const i = data.deployments.findIndex((d) => key(d.base, d.employee_id) === key(base, employeeId))
      if (i < 0) return false
      data.deployments.splice(i, 1)
      atomicWrite(registryFile, data)
      return true
    },
  }
}
