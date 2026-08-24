import { brand } from '../brand'
import type { ServiceHandle } from './contracts'

/**
 * 单实例判定（S-06，D-020，设计 §8）——纯函数零 IO。
 * health 由调用方探测后传入（/healthz 可达性、占用方身份、句柄 pid 存活、连续失败数与耗时预算）。
 */

/** 判定所需的句柄快照（ServiceHandle 的子集，便于测试与注入） */
export type HandleSnapshot = Pick<ServiceHandle, 'pid' | 'port' | 'uid' | 'app'>

/** 调用方探测 /healthz 与 pid 后汇总的快照 */
export interface HealthSnapshot {
  /** /healthz 是否可达 */
  reachable: boolean
  /** 占用方 /healthz 自报的 app（不可达时缺省） */
  app?: string
  /** 占用方 /healthz 自报的 uid（不可达时缺省） */
  uid?: string
  /** 句柄记录的 pid 是否存活 */
  pidAlive: boolean
  /** 连续探测失败次数 */
  consecutiveFails: number
  /** 自句柄 startedAt 起的耗时预算消耗（ms） */
  elapsedMs: number
}

export type InstanceAction =
  | { kind: 'fresh' }
  | { kind: 'idempotent' }
  | { kind: 'conflict' }
  | { kind: 'takeover' }
  | { kind: 'starting' }

/** 接管旧实例的连续失败门槛（设计 §8：连续 3 次失败） */
export const TAKEOVER_MIN_CONSECUTIVE_FAILS = 3
/** 接管旧实例的耗时预算（设计 §8：超 30s） */
export const TAKEOVER_ELAPSED_BUDGET_MS = 30_000

/**
 * 五分支判定：
 * - 无句柄 / 句柄 pid 已死（陈旧） → fresh
 * - /healthz 可达且自报 app+uid 均为自家 → idempotent（幂等退出 0）
 * - /healthz 可达但 app/uid 不符 → conflict（退出码 78）
 * - pid 活、不可达、连续失败与耗时双条件达 → takeover（清 run/ 接管）
 * - pid 活、不可达、未达双条件 → starting（另一实例启动中，静默等待）
 */
export function decideInstanceAction(
  handle: HandleSnapshot | null,
  health: HealthSnapshot,
): InstanceAction {
  if (!handle) return { kind: 'fresh' }

  if (health.reachable) {
    const isOwn =
      health.app === brand.app && health.uid !== undefined && health.uid === handle.uid
    return isOwn ? { kind: 'idempotent' } : { kind: 'conflict' }
  }

  if (!health.pidAlive) return { kind: 'fresh' }

  const failedEnough =
    health.consecutiveFails >= TAKEOVER_MIN_CONSECUTIVE_FAILS &&
    health.elapsedMs >= TAKEOVER_ELAPSED_BUDGET_MS
  return failedEnough ? { kind: 'takeover' } : { kind: 'starting' }
}

/** 各分支的用户可读文案（conflict 含退出码 78 语义与占用信息） */
export function describeAction(action: InstanceAction, handle: HandleSnapshot | null): string {
  const pid = handle?.pid
  const port = handle?.port
  switch (action.kind) {
    case 'fresh':
      return handle
        ? `检测到陈旧句柄（pid ${pid} 已退出，端口 ${port}），将清理 run/ 后启动新实例`
        : '未发现运行中的服务，启动新实例'
    case 'idempotent':
      return `服务已在运行（pid ${pid}，端口 ${port}），幂等处理：打开主页后以退出码 0 退出`
    case 'conflict':
      return `端口 ${port} 已被非本服务的进程占用（app/uid 不匹配，关联 pid ${pid}），将以退出码 78 退出；请检查端口占用或修改配置中的端口`
    case 'takeover':
      return `旧实例僵死（pid ${pid}，健康检查连续失败 ${TAKEOVER_MIN_CONSECUTIVE_FAILS} 次且超过 ${TAKEOVER_ELAPSED_BUDGET_MS / 1000}s），清理 run/ 后接管`
    case 'starting':
      return `另一实例正在启动中（pid ${pid}，健康检查尚未就绪），静默退出等待其完成启动`
  }
}
