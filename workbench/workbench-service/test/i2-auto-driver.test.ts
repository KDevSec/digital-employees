/**
 * I2 批次集成装配测试（A 组 T5+T6）：
 * - startRealServer 装配形态可复现（engine + RealClaudeLauncher + SpawnRunner + Driver 不炸）
 * - simple-flow / simple-flow-human 两张表能 parse，关键节点 human_gate 字段语义正确
 * - Driver 装配后消费 run.created 不炸（事件链能起）
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '@devzero/engine'
import { RealClaudeLauncher } from '../src/engine/real-launcher'
import { SpawnRunner } from '../src/engine/spawn-runner'
import { Driver } from '../src/engine/driver'
import { parseNodeTable } from '@devzero/engine'
import { load as yamlLoad } from 'js-yaml'

const ENGINE_ASSETS = join(__dirname, '..', '..', 'workbench-engine', 'assets', 'flows')

let root: string
let flowsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb-i2-asm-'))
  flowsDir = join(root, 'flows')
  mkdirSync(flowsDir, { recursive: true })
  // 用文件源（不走 assets 内嵌）——单元层准确（bun text 内嵌与 vitest 形态不相同）
  for (const name of ['demo-flow.node-table.yml', 'simple-flow.node-table.yml', 'simple-flow-human.node-table.yml']) {
    writeFileSync(join(flowsDir, name), readFileSync(join(ENGINE_ASSETS, name), 'utf8'), 'utf8')
  }
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('I2 A 组（T5+T6）——长合装配形态', () => {
  it('两张新表 parse：simple-flow（无 human_gate）与 simple-flow-human（仅 g-exit human_gate=true）', () => {
    const simple = parseNodeTable(yamlLoad(readFileSync(join(flowsDir, 'simple-flow.node-table.yml'), 'utf8')))
    const human = parseNodeTable(yamlLoad(readFileSync(join(flowsDir, 'simple-flow-human.node-table.yml'), 'utf8')))
    expect(simple.flow).toBe('simple-flow')
    expect(human.flow).toBe('simple-flow-human')
    // 4 action + 2 gate + 2 terminal = 8 节点（I2 §5「五阶段」= 4 action 节点 + 准出 gate 由 n-adm / n-req / n-design / n-impl + g-design / g-exit 构成）
    expect(simple.nodes.filter((n) => n.kind === 'action').length).toBe(4)
    expect(simple.nodes.filter((n) => n.kind === 'gate').length).toBe(2)
    expect(simple.nodes.filter((n) => n.kind === 'terminal').length).toBe(2)
    // simple-flow 无 human_gate 节点；simple-flow-human 仅 g-exit
    expect(simple.nodes.filter((n) => n.human_gate === true).length).toBe(0)
    const hgNodes = human.nodes.filter((n) => n.human_gate === true)
    expect(hgNodes.map((n) => n.id)).toEqual(['g-exit'])
  })

  it('表首启落位（demo 保不动），三张表可真落 docs（main.ts:242-248 同构保障）', () => {
    // 这是 main.ts 首启逻辑的同构验证——测试不能调 startRealServer（Bun text 内嵌），
    // 但创建 flowsDir 逻辑与 main.ts 重复不重复靠该用例住调（表在盘 → Engine.loadFlowTemplate 能集会读）
    const engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flowsDir })
    const flowList = engine.flowsList()
    const ids = flowList.map((f) => f.flow)
    expect(ids).toContain('demo-flow')
    expect(ids).toContain('simple-flow')
    expect(ids).toContain('simple-flow-human')
  })

  it('Driver 装配不炸：engine + RealClaudeLauncher + SpawnRunner + Driver.start/stop', () => {
    const engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flowsDir })
    const launcher = new RealClaudeLauncher({ registryFile: join(root, 'registry.json') })
    const runner = new SpawnRunner({ launcher })
    const driver = new Driver(engine, runner)
    expect(() => { driver.start() }).not.toThrow()
    expect(() => { driver.stop() }).not.toThrow()
    expect(driver.suspendedTasks().size).toBe(0)
  })

  it('run.created 事件动报：Driver 查询表 + 决定首派发节点（简单流程真查）', async () => {
    const engine = new Engine({ dataDir: join(root, 'data'), templatesDir: flowsDir })
    // launcher 这里换成 mock——防止真 spawn claude；但 Driver 内部派发决定不问 launcher、只有带进表
    const record: string[] = []
    const launcher = {
      async launch(req: any): Promise<{ code: number }> {
        record.push(`${req.deploymentHint.emp}@${req.workdir}`)
        return { code: 0 }
      },
    }
    const runner = new SpawnRunner({ launcher })
    const driver = new Driver(engine, runner)
    driver.start()

    const { task_id } = engine.createTask({
      mode: 'team', flow: 'simple-flow',
      workspace: join(root, 'ws'), title: 'T', input: 'demo',
    })
    // 让事件动传落实（driver.ts 是 async onEvent）
    await new Promise((r) => setTimeout(r, 50))

    expect(record.length).toBeGreaterThan(0)
    expect(record[0]).toContain('sec-compliance')   // 首节点 n-adm 是 sec-compliance 准入
    driver.stop()
  })
})
