/**
 * 看板运行时挑选（L5 看板线 T9，设计 §6.5）：dev 默认 fixture 演出（引擎线未通时的
 * 看板开发主场景）；?live=1 强制真实（联调通道）；?fixture=1 显式演出（演示场景）；
 * 生产 build 一律真实。fixture 模块动态 import 隔离——生产 bundle 不含演出设施（D-kb04）。
 */
import { httpEngineApi, type EngineApi } from '../api/engine-api'
import { createEngineStream, streamUrl, type EngineStream } from '../api/engine-stream'

export type RuntimeMode = 'fixture' | 'live'

export interface KanbanRuntime {
  api: EngineApi
  openStream(): EngineStream
  cleanup(): void
}

/** URL 显式参数 > dev/prod 默认；live 与 fixture 同在时 live 优先 */
export function resolveRuntimeMode(search: string, dev: boolean): RuntimeMode {
  const params = new URLSearchParams(search)
  if (params.has('live')) return 'live'
  if (params.has('fixture')) return 'fixture'
  return dev ? 'fixture' : 'live'
}

export async function createKanbanRuntime(): Promise<KanbanRuntime> {
  const mode = resolveRuntimeMode(
    typeof location !== 'undefined' ? location.search : '',
    import.meta.env.DEV,
  )
  if (mode === 'fixture') {
    const mod = await import('../fixtures/kanban-fixture-service')
    return mod.createFixtureRuntime()
  }
  return {
    api: httpEngineApi,
    openStream: () => createEngineStream(streamUrl()),
    cleanup: () => {},
  }
}
