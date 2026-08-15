import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EncryptedStateStore } from '../src/state-store.js'


describe('EncryptedStateStore', () => {
  it('persists private JWK encrypted and restores the same installation identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-state-'))
    const path = join(directory, 'state.enc')
    const store = new EncryptedStateStore(path, 'test-secret-that-is-at-least-32-chars')

    const created = await store.loadOrCreate()
    const bytes = await readFile(path, 'utf8')
    const restored = await new EncryptedStateStore(path, 'test-secret-that-is-at-least-32-chars').loadOrCreate()

    expect(bytes).not.toContain(created.privateJwk.d ?? '')
    expect(restored.installationId).toBe(created.installationId)
    expect(restored.publicJwk).toEqual(created.publicJwk)
  })
})
