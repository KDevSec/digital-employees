import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EncryptedJsonStore } from '../src/app/platform-access/encrypted-store'

describe('EncryptedJsonStore（demo 加密层泛化）', () => {
  it('明文不出现在磁盘上，重开实例恢复同一值', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-store-'))
    const path = join(directory, 'data.enc')
    const store = new EncryptedJsonStore<{ secret: string }>(path, 'test-secret-that-is-at-least-32-chars')

    await store.save({ secret: '私钥材料' })
    const bytes = await readFile(path, 'utf8')
    expect(bytes).not.toContain('私钥材料')

    const restored = await new EncryptedJsonStore<{ secret: string }>(path, 'test-secret-that-is-at-least-32-chars').load()
    expect(restored).toEqual({ secret: '私钥材料' })
  })

  it('文件不存在 → undefined（与损坏区分）', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-store-'))
    const store = new EncryptedJsonStore<Record<string, unknown>>(join(directory, 'absent.enc'), 'test-secret-that-is-at-least-32-chars')
    expect(await store.load()).toBeUndefined()
  })

  it('密文被篡改 → 抛错（不静默给假数据）', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-store-'))
    const path = join(directory, 'data.enc')
    const store = new EncryptedJsonStore<{ a: number }>(path, 'test-secret-that-is-at-least-32-chars')
    await store.save({ a: 1 })
    const envelope = JSON.parse(await readFile(path, 'utf8')) as { ciphertext: string }
    envelope.ciphertext = envelope.ciphertext.slice(0, -4) + 'AAAA'
    await writeFile(path, JSON.stringify(envelope), 'utf8')

    await expect(store.load()).rejects.toThrow()
  })

  it('换密钥打不开旧文件（auth-tag 校验兜底）', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-store-'))
    const path = join(directory, 'data.enc')
    await new EncryptedJsonStore<{ a: number }>(path, 'test-secret-that-is-at-least-32-chars').save({ a: 1 })
    await expect(new EncryptedJsonStore<{ a: number }>(path, 'another-secret-that-is-at-least-32').load()).rejects.toThrow()
  })

  it('短密钥拒绝（≥32 字符，A-06 纪律）', () => {
    expect(() => new EncryptedJsonStore(join('x', 'y'), 'short')).toThrow(/32/)
  })
})
