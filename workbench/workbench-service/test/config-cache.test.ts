import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { cacheMatchesConfig, PlatformConfigCache } from '../src/app/platform-access/config-cache'
import type { WorkbenchConfiguration } from '../src/app/platform-access/platform-client'

const CONFIG: WorkbenchConfiguration = {
  platform_base_url: 'http://192.168.45.50:18000',
  oidc_issuer: 'http://192.168.45.50:18000/oauth2/workbench',
  oidc_client_id: 'workbench-desktop',
  enrollment_endpoint: 'http://192.168.45.50:18000/api/v1/workbench-enrollments',
  machine_token_endpoint: 'http://192.168.45.50:18000/oauth2/workbench/token',
  protocol_version: 'v1',
}

describe('PlatformConfigCache（A-01）', () => {
  it('write → read 往返；无文件 → undefined；损坏 → undefined（当没有）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-config-cache-'))
    const cache = new PlatformConfigCache(dir)
    expect(await cache.read()).toBeUndefined()
    await cache.write(CONFIG)
    expect(await cache.read()).toEqual(CONFIG)

    await writeFile(join(dir, 'platform-config.json'), '{not json', 'utf8')
    expect(await cache.read()).toBeUndefined()
  })

  it('明文落盘（非敏感：端点地址，不含任何密钥）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-config-cache-'))
    await new PlatformConfigCache(dir).write(CONFIG)
    const raw = await readFile(join(dir, 'platform-config.json'), 'utf8')
    expect(raw).toContain('http://192.168.45.50:18000')
  })
})

describe('cacheMatchesConfig（来源校验）', () => {
  it('同地址（含尾斜杠差异）→ true；平台已迁移 → false', () => {
    expect(cacheMatchesConfig(CONFIG, 'http://192.168.45.50:18000')).toBe(true)
    expect(cacheMatchesConfig(CONFIG, 'http://192.168.45.50:18000/')).toBe(true)
    expect(cacheMatchesConfig(CONFIG, 'http://new-platform:18000')).toBe(false)
  })
})
