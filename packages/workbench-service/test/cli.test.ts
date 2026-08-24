import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProgram } from '../src/cli'
import type { CliDeps } from '../src/cli'

function makeCliDeps(overrides: Partial<CliDeps> = {}) {
  const calls: string[] = []
  const exits: number[] = []
  const deps: CliDeps = {
    start: async (opts) => {
      calls.push(`start:${JSON.stringify(opts)}`)
      return 0
    },
    stop: async () => {
      calls.push('stop')
      return 0
    },
    status: async () => {
      calls.push('status')
      return JSON.stringify({
        app: 'workbench',
        running: true,
        pid: 123,
        port: 19980,
        version: '0.1.0',
        uptime: 5,
        health: 'ok',
        pendingUpdate: null,
      })
    },
    portal: async () => {
      calls.push('portal')
      return 0
    },
    activity: async () => {
      calls.push('activity')
      return JSON.stringify({ conversationTasks: 0, triggerTasks: 0 })
    },
    probeHealthz: async () => {
      calls.push('probeHealthz')
      return true
    },
    exit: (code) => {
      calls.push(`exit:${code}`)
      exits.push(code)
    },
    ...overrides,
  }
  return { deps, calls, exits }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildProgram 命令面（S-02，设计 §4）', () => {
  it('start → 调 deps.start 并以其返回值为退出码', async () => {
    const { deps, calls, exits } = makeCliDeps()
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'start'])
    expect(calls).toContain('start:{}')
    expect(exits).toEqual([0])
  })

  it('start 返回 78（conflict 由 main 捕获转译）→ 退出码 78 透传', async () => {
    const { deps, exits } = makeCliDeps({ start: async () => 78 })
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'start'])
    expect(exits).toEqual([78])
  })

  it('start --foreground / --no-keepalive 本波同义静默接受（选项透传）', async () => {
    const { deps, calls } = makeCliDeps()
    // commander 程序对象不可复用（选项值残留），每次 parse 建新实例
    await buildProgram(deps).parseAsync(['node', 'workbench', 'start', '--foreground'])
    await buildProgram(deps).parseAsync(['node', 'workbench', 'start', '--no-keepalive'])
    const starts = calls.filter((c) => c.startsWith('start:'))
    expect(starts).toContain('start:{"foreground":true}')
    expect(starts).toContain('start:{"keepalive":false}')
  })

  it('stop → 调 deps.stop', async () => {
    const { deps, calls } = makeCliDeps()
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'stop'])
    expect(calls).toContain('stop')
  })

  it('status → 调 deps.status 并打印 JSON（含 pid/port/version/uptime/health/pendingUpdate:null）', async () => {
    const { deps, calls } = makeCliDeps()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'status'])

    expect(calls).toContain('status')
    const printed = log.mock.calls.map((args) => args.join(' ')).join('\n')
    const json = JSON.parse(printed) as Record<string, unknown>
    expect(json).toMatchObject({
      pid: 123,
      port: 19980,
      version: '0.1.0',
      uptime: 5,
      health: 'ok',
      pendingUpdate: null,
    })
  })

  it('portal → 调 deps.portal', async () => {
    const { deps, calls } = makeCliDeps()
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'portal'])
    expect(calls).toContain('portal')
  })

  it('activity → 调 deps.activity 并打印 JSON', async () => {
    const { deps, calls } = makeCliDeps()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', 'activity'])
    expect(calls).toContain('activity')
    const printed = log.mock.calls.map((args) => args.join(' ')).join('\n')
    expect(JSON.parse(printed)).toEqual({ conversationTasks: 0, triggerTasks: 0 })
  })

  it('__daemon → 走 start（守护路径，本波与 start 同为前台 daemon 形态）', async () => {
    const { deps, calls } = makeCliDeps()
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', '__daemon'])
    expect(calls.some((c) => c.startsWith('start:'))).toBe(true)
  })

  it('无子命令 → 默认走守护路径（设计 §4：被守护拉起时不带参）', async () => {
    const { deps, calls } = makeCliDeps()
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench'])
    expect(calls.some((c) => c.startsWith('start:'))).toBe(true)
  })
})

describe('__health-wait（内部子命令：托盘/安装脚本消费）', () => {
  it('probeHealthz 立即 ok → 快速退出码 0（不等满超时）', async () => {
    const { deps, exits } = makeCliDeps()
    const program = buildProgram(deps)
    const t0 = Date.now()
    await program.parseAsync(['node', 'workbench', '__health-wait', '15000'])
    const elapsed = Date.now() - t0
    expect(exits).toEqual([0])
    expect(elapsed).toBeLessThan(5000)
  })

  it('probeHealthz 永远 fail → 超时后非 0 退出', async () => {
    const { deps, exits } = makeCliDeps({ probeHealthz: async () => false })
    const program = buildProgram(deps)
    await program.parseAsync(['node', 'workbench', '__health-wait', '150'])
    expect(exits).toEqual([1])
  })

  it('非数字参数（NaN）→ 守卫直接退出 1，不死循环', async () => {
    const { deps, exits } = makeCliDeps({ probeHealthz: async () => false })
    const program = buildProgram(deps)
    const t0 = Date.now()
    await program.parseAsync(['node', 'workbench', '__health-wait', 'abc'])
    expect(exits).toEqual([1])
    expect(Date.now() - t0).toBeLessThan(2000) // 无守卫时 Date.now()>=NaN 恒 false → 死循环
  })
})

describe('help 面（隐藏内部命令，设计 §4：__ 前缀不进 --help）', () => {
  it('help 不含 __daemon / __health-wait，含全部公开命令', () => {
    const { deps } = makeCliDeps()
    const program = buildProgram(deps)
    const help = program.helpInformation()
    expect(help).not.toContain('__daemon')
    expect(help).not.toContain('__health-wait')
    for (const cmd of ['start', 'stop', 'status', 'portal', 'activity']) {
      expect(help).toContain(cmd)
    }
  })
})
