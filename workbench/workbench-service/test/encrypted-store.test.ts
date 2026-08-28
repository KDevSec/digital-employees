import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { PathLike } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

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

describe('EncryptedJsonStore 原子写加固（026：Windows EPERM/并发）', () => {
  const SECRET = 'test-secret-that-is-at-least-32-chars'

  it('并发 N 次 save：全部完成、最终值为完整 JSON、无 tmp 残留', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-concurrent-'))
    const path = join(directory, 'state.enc')
    const store = new EncryptedJsonStore<{ n: number }>(path, SECRET)
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.save({ n: index })))
    const restored = await new EncryptedJsonStore<{ n: number }>(path, SECRET).load()
    expect(restored).toEqual({ n: 19 })
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(directory)
    expect(files.filter((name) => name.endsWith('.tmp') || name.includes('.tmp.'))).toEqual([])
  })

  it('rename 遇 EPERM（Windows 杀软短暂占用）→ 退避重试后成功', async () => {
    const { rename: originalRename } = await import('node:fs/promises')
    const directory = await mkdtemp(join(tmpdir(), 'wb-enc-retry-'))
    const path = join(directory, 'state.enc')
    let attempts = 0
    const flakyRename = vi.fn(async (from: PathLike, to: PathLike) => {
      attempts += 1
      if (attempts <= 2) {
        const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return originalRename(from, to) // 第三次放行：执行真实 rename 落盘
    })
    const store = new EncryptedJsonStore<{ n: number }>(path, SECRET, { rename: flakyRename })
    await store.save({ n: 1 })
    expect(attempts).toBe(3)
    const restored = await new EncryptedJsonStore<{ n: number }>(path, SECRET).load()
    expect(restored).toEqual({ n: 1 })
  })
})
