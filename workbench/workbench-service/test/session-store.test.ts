import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SessionStore } from '../src/app/platform-access/session-store'

const SECRET = 'test-secret-that-is-at-least-32-chars'

describe('SessionStore（A-07：demo 内存 Map → 加密持久化）', () => {
  it('写后读回同一会话；重开实例（重启）仍可读——免重登的数据基础', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-sessions-'))
    const path = join(dir, 'sessions.enc')
    const store = new SessionStore(path, SECRET)
    await store.set('sid-1', { accessToken: 'token-1', claims: { email: 'a@b.c' }, expiresAt: Date.now() + 60_000 })

    const reopened = new SessionStore(path, SECRET)
    expect(await reopened.get('sid-1')).toEqual({ accessToken: 'token-1', claims: { email: 'a@b.c' }, expiresAt: expect.any(Number) })
  })

  it('过期会话 get 返回 undefined 且被清除；set 时顺带清扫全部过期项', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-sessions-'))
    const store = new SessionStore(join(dir, 'sessions.enc'), SECRET)
    await store.set('expired', { accessToken: 't', claims: {}, expiresAt: Date.now() - 1 })
    await store.set('alive', { accessToken: 't2', claims: {}, expiresAt: Date.now() + 60_000 })

    expect(await store.get('expired')).toBeUndefined()
    // set 触发全量清扫后，expired 记录不再占位
    await store.set('another', { accessToken: 't3', claims: {}, expiresAt: Date.now() + 60_000 })
    expect(await store.get('alive')).toBeDefined()
    expect(await store.get('another')).toBeDefined()
  })

  it('多会话并存（多浏览器 cookie 隔离，设计 §7）；delete 后不可读', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wb-sessions-'))
    const store = new SessionStore(join(dir, 'sessions.enc'), SECRET)
    await store.set('browser-a', { accessToken: 'ta', claims: {}, expiresAt: Date.now() + 60_000 })
    await store.set('browser-b', { accessToken: 'tb', claims: {}, expiresAt: Date.now() + 60_000 })

    expect((await store.get('browser-a'))?.accessToken).toBe('ta')
    expect((await store.get('browser-b'))?.accessToken).toBe('tb')

    await store.delete('browser-a')
    expect(await store.get('browser-a')).toBeUndefined()
    expect(await store.get('browser-b')).toBeDefined()
  })
})
