/**
 * fixture 运行时（L5 看板线 T9，设计 §6.4）：EngineApi + SSE 流的 mock 全套——
 * 看板在引擎线（feat/l3-engine）打通前的开发/演示主通道（D-kb04：动态 import 隔离，
 * 生产构建默认不走此模块）。
 *
 * 演出语义：
 * - createTask → 202 形状 {task_id}（R-N 递增）+ 当前选中剧本入队自动开播；
 * - gate-pause 剧本推到停靠帧（transition.status=gate_paused）自动 pause——
 *   confirmGate 辅按钮/对话式放行即 resume（演出闭环）；
 * - getTask 随任务下发表快照 + 员工映射（契约歧义 A/B 的 fixture 口径）；
 * - replayLast = 同剧本新开一 run 再演（同 taskId 重推会被消费层 seq 去重吞掉）。
 */
import type { EngineApi } from '../api/engine-api'
import type { EngineEvent } from '../api/engine-events'
import type { EngineStream, EventSourceLike } from '../api/engine-stream'
import { createEngineStream, streamUrl } from '../api/engine-stream'
import { MockEventSource, type MockFrame } from './mock-event-source'
import { buildScenario, employees, scenarioTable, type ScenarioName } from './scenarios'

export interface FixtureControls {
  /** 切换剧本（下一次 createTask 生效） */
  setScenario(name: ScenarioName): void
  scenario(): ScenarioName
  /** 手动暂停/恢复（演出节奏控制） */
  pause(): void
  resume(): void
  /** 推干队列（测试/快进演出） */
  drain(): void
  /** 演出暂停态（gate-pause 自动停靠后为 true） */
  isPaused(): boolean
  /** 同剧本再演一遍（新 run） */
  replayLast(): void
  lastTaskId(): string | null
}

export interface FixtureRuntime {
  api: EngineApi
  openStream(): EngineStream
  /** mock source 直取（测试取证/FixtureControls 演出控制） */
  openMockSource(): MockEventSource
  controls: FixtureControls
  /** 员工 display 映射（员工选择器数据源——契约歧义 C 的 fixture 口径） */
  employees: Record<string, string>
  cleanup(): void
}

function frameOf(ev: EngineEvent): MockFrame {
  return { event: ev.type, data: JSON.stringify(ev), id: String(ev.seq) }
}

export function createFixtureRuntime(opts: { intervalMs?: number } = {}): FixtureRuntime {
  let scenario: ScenarioName = 'happy-path'
  let taskNo = 0
  let lastTaskId: string | null = null
  let lastPayload: { title: string; workspace: string } | null = null

  const source = new MockEventSource(streamUrl(), {
    intervalMs: opts.intervalMs ?? 250,
    // 停靠检测：推到 gate_paused 帧即暂停（pump 循环尊重 pausedFlag，不越过停靠帧）
    onFrame: (frame) => {
      if (frame.event !== 'transition') return
      try {
        const ev = JSON.parse(frame.data) as { status?: string }
        if (ev.status === 'gate_paused') source.pause()
      } catch {
        /* 非法帧不处理 */
      }
    },
  })

  function spawnRun(): string {
    taskNo += 1
    const taskId = `R-${taskNo}`
    lastTaskId = taskId
    const events = buildScenario(scenario, {
      taskId,
      title: lastPayload?.title ?? `演示任务 ${taskNo}`,
      workspace: lastPayload?.workspace ?? 'D:/demo/workspace',
    })
    source.enqueueFrames(events.map(frameOf))
    source.resume()
    source.start()
    return taskId
  }

  const api: EngineApi = {
    async createTask(payload) {
      lastPayload = { title: payload.title, workspace: payload.workspace }
      const taskId = spawnRun()
      return { task_id: taskId }
    },
    async getTask(taskId) {
      return {
        task: { task_id: taskId, flow: 'demo-flow' },
        table: scenarioTable[scenario],
        employees,
      }
    },
    async getFlows() {
      return [{ flow: 'demo-flow', display_name: '五阶段演示交付' }]
    },
    async confirmGate(_taskId, _node, _verdict) {
      // 演出闭环：停靠中放行 = 恢复推流（真实语义由引擎实现）
      source.resume()
      return { ok: true }
    },
  }

  const controls: FixtureControls = {
    setScenario: (name) => {
      scenario = name
    },
    scenario: () => scenario,
    pause: () => source.pause(),
    resume: () => source.resume(),
    drain: () => source.flushAll(),
    isPaused: () => source.isPaused(),
    replayLast: () => {
      spawnRun()
    },
    lastTaskId: () => lastTaskId,
  }

  return {
    api,
    // fixture 的 stream = 消费层包同一个 mock source（去重/状态机逻辑与 live 完全同路）；
    // 先建流（消费层挂上 onopen）再 emitOpen——顺序反了的话 open 通知落在 null 回调上
    openStream: () => {
      const stream = createEngineStream(streamUrl(), {
        factory: () => source as unknown as EventSourceLike,
      })
      source.emitOpen()
      return stream
    },
    openMockSource: () => source,
    controls,
    employees,
    cleanup: () => source.close(),
  }
}
