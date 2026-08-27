import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { WorkbenchStateStore } from '../src/app/platform-access/state-store'

const SECRET = 'test-secret-that-is-at-least-32-chars'

describe('WorkbenchStateStore（demo state-store 迁移 + installationId 外部注入）', () => {
  it('首启生成 ES256 密钥对，状态 NEW；密文落盘不含私钥材料', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-state-store-'))
    const path = join(dir, 'state.enc')
    const store = new WorkbenchStateStore(path, SECRET)

    const created = await store.loadOrCreate()
    expect(created.status).toBe('NEW')
    expect(created.privateJwk.d).toBeTruthy()   // 私钥在场
    expect(created.publicJwk.crv).toBe('P-256') // ES256 密钥对
    const bytes = await readFile(path, 'utf8')
    expect(bytes).not.toContain(created.privateJwk.d ?? '')
    // installationId 不在 state 里（外部注入——详设 §6.1）
    expect('installationId' in created).toBe(false)
    expect(bytes).not.toContain('installationId')
  })

  it('重开实例恢复同一身份（installationId 由外部持有，不随状态漂移）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-state-store-'))
    const path = join(dir, 'state.enc')
    const created = await new WorkbenchStateStore(path, SECRET).loadOrCreate()
    created.status = 'PENDING_REVIEW'
    await new WorkbenchStateStore(path, SECRET).save(created)

    const restored = await new WorkbenchStateStore(path, SECRET).loadOrCreate()
    expect(restored.publicJwk).toEqual(created.publicJwk)
    expect(restored.privateJwk).toEqual(created.privateJwk)
    expect(restored.status).toBe('PENDING_REVIEW')
  })
})
