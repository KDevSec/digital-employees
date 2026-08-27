/**
 * A-01 发现配置本地缓存（设计 §5.1）：discover 成功落明文 JSON（非敏感——五个端点地址），
 * 平台不可达时登录回退用；回退前经 cacheMatchesConfig 校验来源（配置已换平台则旧缓存不生效）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { WorkbenchConfiguration } from './platform-client'

const FILE = 'platform-config.json'

export class PlatformConfigCache {
  constructor(private readonly authDir: string) {}

  private get path(): string {
    return join(this.authDir, FILE)
  }

  async read(): Promise<WorkbenchConfiguration | undefined> {
    let raw: string | undefined
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      return undefined
    }
    try {
      return JSON.parse(raw) as WorkbenchConfiguration
    } catch {
      return undefined // 损坏缓存当没有（非敏感数据，重建成本低）
    }
  }

  async write(config: WorkbenchConfiguration): Promise<void> {
    await mkdir(this.authDir, { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(config, null, 2))
    await rename(temporary, this.path)
  }
}

/** 缓存可用判据：缓存的 platform_base_url 与当前配置 baseUrl 归一化后相等（去尾斜杠全等） */
export function cacheMatchesConfig(config: WorkbenchConfiguration, baseUrl: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/, '')
  return normalize(config.platform_base_url) === normalize(baseUrl)
}
