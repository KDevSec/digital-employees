/**
 * CLI 面（S-02，设计 §4）：commander 组装。
 * 命令动作只做分发与退出码转译，业务全在 deps（main.ts 注入真实实现，测试注入伪实现）。
 * `__` 前缀命令隐藏（不进 --help）：公开面保兼容，内部面随改。
 */
import { Command } from 'commander'

export interface StartOptions {
  foreground?: boolean
  keepalive?: boolean
  /** `__daemon` 内部入口（本波与 start 同为前台 daemon 形态，预留区分） */
  daemon?: boolean
}

export interface CliDeps {
  start(opts: StartOptions): Promise<number> | number
  stop(): Promise<number> | number
  /** 返回 status JSON 字符串（main 聚合 service.json + healthz） */
  status(): Promise<string> | string
  portal(opts: { printUrl: boolean }): Promise<number> | number
  /** 返回 activity JSON 字符串 */
  activity(): Promise<string> | string
  /** 单次 healthz 探测（__health-wait 轮询消费） */
  probeHealthz(): Promise<boolean> | boolean
  /** 退出（main 注入 process.exit；测试注入记录器） */
  exit(code: number): void
}

/** health-wait 轮询间隔（退出码语义：ok=0 / 超时=1） */
const HEALTH_WAIT_POLL_MS = 200

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('workbench')
  program
    .description('数字员工工作台服务（V0.1 框架增量）')
    // 无子命令 → 守护路径（设计 §4：守护配置不带参拉起时走默认 action）
    .action(async () => {
      const code = await deps.start({ daemon: true })
      deps.exit(code)
    })

  program
    .command('start')
    .description('启动服务（本波无守护注册，start 即前台 daemon 形态）')
    .option('--foreground', '前台运行（本波默认行为，静默接受）')
    .option('--no-keepalive', '不注册守护（本波无守护注册，静默接受）')
    .action(async (opts: { foreground?: boolean; keepalive?: boolean }) => {
      // --no-keepalive 缺省时 commander 置 keepalive=true；只透传显式给出的旗标（本波同义静默接受）
      const code = await deps.start({
        ...(opts.foreground === true ? { foreground: true } : {}),
        ...(opts.keepalive === false ? { keepalive: false } : {}),
      })
      deps.exit(code)
    })

  program
    .command('stop')
    .description('优雅停服')
    .action(async () => {
      const code = await deps.stop()
      deps.exit(code)
    })

  program
    .command('status')
    .description('服务状态 JSON：pid/port/version/uptime/health/pendingUpdate')
    .action(async () => {
      const json = await deps.status()
      console.log(json)
      deps.exit(0)
    })

  program
    .command('portal')
    .description('打开工作台主页')
    .option('--print-url', '仅打印 URL 不开浏览器')
    .action(async (opts: { printUrl?: boolean }) => {
      const code = await deps.portal({ printUrl: opts.printUrl === true })
      deps.exit(code)
    })

  program
    .command('activity')
    .description('活动任务 JSON：{conversationTasks, triggerTasks}')
    .action(async () => {
      const json = await deps.activity()
      console.log(json)
      deps.exit(0)
    })

  program
    .command('__daemon', { hidden: true })
    .description('内部：守护入口')
    .action(async () => {
      const code = await deps.start({ daemon: true })
      deps.exit(code)
    })

  program
    .command('__health-wait [ms]', { hidden: true })
    .description('内部：等待 /healthz 就绪（托盘/安装脚本消费）')
    .action(async (ms: string | undefined) => {
      const budget = ms === undefined ? 15000 : Number(ms)
      if (!Number.isFinite(budget) || budget < 0) {
        // NaN/负数守卫：Date.now() >= NaN 恒 false，无守卫会死循环
        deps.exit(1)
        return
      }
      const deadline = Date.now() + budget
      for (;;) {
        if (await deps.probeHealthz()) {
          deps.exit(0)
          return
        }
        if (Date.now() >= deadline) {
          deps.exit(1)
          return
        }
        await sleep(Math.min(HEALTH_WAIT_POLL_MS, Math.max(deadline - Date.now(), 1)))
      }
    })

  return program
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
