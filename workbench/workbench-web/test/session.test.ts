// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/access', () => ({
  fetchAccessState: vi.fn(),
}))

import { fetchAccessState } from '../src/api/access'
import { useSessionStore } from '../src/stores/session'
import type { AccessState } from '../src/api/access'

/**
 * session store 骨架（I0-5 T2）：T3 路由守卫的消费方，本任务只立形状——
 * state {accessState, loaded} / getter authenticated / action fetchState。
 * fetchAccessState 以模块 mock 顶替（store 不做网络）。
 */

const activeState: AccessState = {
  installationId: 'inst-1',
  status: 'ACTIVE',
  authenticated: true,
  user: { name: '张三' },
}

describe('useSessionStore（session store 骨架）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchAccessState).mockReset()
  })

  it('初始态：accessState null / loaded false / authenticated false', () => {
    const store = useSessionStore()
    expect(store.accessState).toBeNull()
    expect(store.loaded).toBe(false)
    expect(store.authenticated).toBe(false)
  })

  it('fetchState 成功 → 存入 accessState、loaded 置真、authenticated 取自状态', async () => {
    vi.mocked(fetchAccessState).mockResolvedValue(activeState)
    const store = useSessionStore()
    await store.fetchState()
    expect(fetchAccessState).toHaveBeenCalledTimes(1)
    expect(store.accessState).toStrictEqual(activeState)
    expect(store.loaded).toBe(true)
    expect(store.authenticated).toBe(true)
  })

  it('fetchState 归一 null（fetch 失败）→ accessState null、loaded 置真、authenticated false（D-7 失败按未认证）', async () => {
    vi.mocked(fetchAccessState).mockResolvedValue(null)
    const store = useSessionStore()
    await store.fetchState()
    expect(store.accessState).toBeNull()
    expect(store.loaded).toBe(true)
    expect(store.authenticated).toBe(false)
  })

  it('未登录态（authenticated:false 的状态）→ getter false', async () => {
    vi.mocked(fetchAccessState).mockResolvedValue({ installationId: 'inst-1', status: 'NEW', authenticated: false })
    const store = useSessionStore()
    await store.fetchState()
    expect(store.authenticated).toBe(false)
  })
})
