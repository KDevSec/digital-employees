import { describe, expect, it } from 'vitest'
import { decideInstanceAction, describeAction } from '../src/runtime/instance'
import type { HandleSnapshot, HealthSnapshot, InstanceAction } from '../src/runtime/instance'

const handle: HandleSnapshot = { pid: 123, port: 19980, uid: 'u1', app: 'workbench' }

function health(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    reachable: false,
    pidAlive: false,
    consecutiveFails: 0,
    elapsedMs: 0,
    ...overrides,
  }
}

describe('decideInstanceAction（S-06 五分支，表驱动，纯函数零 IO）', () => {
  const cases: Array<{
    name: string
    handle: HandleSnapshot | null
    health: HealthSnapshot
    expected: InstanceAction['kind']
  }> = [
    {
      name: '无句柄 → fresh（起服务）',
      handle: null,
      health: health(),
      expected: 'fresh',
    },
    {
      name: '可达且 app/uid 均匹配自家 → idempotent（开浏览器退出 0）',
      handle,
      health: health({ reachable: true, app: 'workbench', uid: 'u1', pidAlive: true }),
      expected: 'idempotent',
    },
    {
      name: '可达但 app 不符 → conflict（78）',
      handle,
      health: health({ reachable: true, app: 'someone-else', uid: 'u1', pidAlive: true }),
      expected: 'conflict',
    },
    {
      name: '可达但 uid 不符 → conflict（78）',
      handle,
      health: health({ reachable: true, app: 'workbench', uid: 'u2', pidAlive: true }),
      expected: 'conflict',
    },
    {
      name: '句柄在、pid 活、不可达、fails≥3 且 elapsed≥30s → takeover（清 run/ 接管）',
      handle,
      health: health({ pidAlive: true, consecutiveFails: 3, elapsedMs: 30000 }),
      expected: 'takeover',
    },
    {
      name: '句柄在、pid 活、不可达、fails 不足双条件 → starting（别人正在启动）',
      handle,
      health: health({ pidAlive: true, consecutiveFails: 2, elapsedMs: 60000 }),
      expected: 'starting',
    },
    {
      name: '句柄在、pid 活、不可达、elapsed 不足双条件 → starting',
      handle,
      health: health({ pidAlive: true, consecutiveFails: 5, elapsedMs: 29999 }),
      expected: 'starting',
    },
    {
      name: '句柄在但 pid 已死 → fresh（陈旧句柄）',
      handle,
      health: health({ pidAlive: false, consecutiveFails: 5, elapsedMs: 60000 }),
      expected: 'fresh',
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const action = decideInstanceAction(c.handle, c.health)
      expect(action.kind).toBe(c.expected)
    })
  }
})

describe('describeAction（文案函数）', () => {
  it('conflict 文案含退出码 78 语义与占用端口', () => {
    const action = decideInstanceAction(
      handle,
      health({ reachable: true, app: 'someone-else', uid: 'u2', pidAlive: true }),
    )
    const text = describeAction(action, handle)
    expect(text).toContain('78')
    expect(text).toContain('19980')
  })

  it('五个分支文案均非空，且 fresh + null 句柄不抛错', () => {
    const fresh = decideInstanceAction(null, health())
    const stale = decideInstanceAction(handle, health({ pidAlive: false }))
    const idempotent = decideInstanceAction(
      handle,
      health({ reachable: true, app: 'workbench', uid: 'u1', pidAlive: true }),
    )
    const conflict = decideInstanceAction(
      handle,
      health({ reachable: true, app: 'x', uid: 'u2', pidAlive: true }),
    )
    const takeover = decideInstanceAction(
      handle,
      health({ pidAlive: true, consecutiveFails: 3, elapsedMs: 30000 }),
    )
    const starting = decideInstanceAction(handle, health({ pidAlive: true }))

    for (const [action, h] of [
      [fresh, null],
      [stale, handle],
      [idempotent, handle],
      [conflict, handle],
      [takeover, handle],
      [starting, handle],
    ] as Array<[InstanceAction, HandleSnapshot | null]>) {
      const text = describeAction(action, h)
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    }
  })
})
