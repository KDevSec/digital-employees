import type { AccessState } from './access'

/**
 * F-04 顶栏平台状态纯函数（I0-5 T4，设计 §3 尾段「F-04 顶栏数据源」）：
 * interpretPlatformStatus 把 /api/state 消费结果压成五档展示状态；statusBadge 出徽章
 * 文案/语义类；alertBanner 只在 unreachable/revoked 给告警条文案（D-032 提示而非降级——
 * 告警条只提示，不锁任何功能）。三者均为纯函数（无 DOM / 无网络），时间基准经 now 注入。
 *
 * 判定粒度说明：unreachable 指「本地服务/代理不可达」——同源 fetch /api/state 失败已由
 * fetchAccessState 归一 null，本函数把 null 压成该档；它与 v0.2 §2.5 的「平台不可达」
 * （工作台服务到远端平台的出站连接问题）不是同一层。A 系列服务端（app/platform-access）
 * 落地后可经 state.error 特征细分两类，本版前端以 fetch 结果为准（取舍：不臆测错误体形状）。
 */

/** 心跳新鲜阈值：A-05 后台心跳 60s 建议值的前端观察容差（60s 发送节奏 + 网络/调度抖动余量） */
export const HEARTBEAT_FRESH_MS = 90_000

/** 五档平台状态（ok 绿 / stale 黄 / revoked 红 / inactive 灰 / unreachable 红） */
export type PlatformStatus = 'ok' | 'stale' | 'revoked' | 'inactive' | 'unreachable'

/** 平台状态徽章（文案 + 语义类，供顶栏 .platform-badge 消费） */
export interface PlatformStatusBadge {
  label: string
  badgeClass: 'ok' | 'warn' | 'error' | 'neutral'
}

/**
 * /api/state 消费结果 → 五档平台状态。
 * - null（fetch 失败归一）→ unreachable；
 * - REVOKED → revoked（优先于心跳判定：撤销事实压过心跳残留）；
 * - ACTIVE + 心跳距今 < HEARTBEAT_FRESH_MS → ok；心跳缺失/陈旧/非法日期 → stale
 *   （无法证明新鲜就按陈旧提示，Date.parse 的 NaN 与 undefined 同归此档）；
 * - 其余（NEW/PENDING_REVIEW/APPROVED/COMPLETED/REJECTED/ERROR——未激活各态）→ inactive。
 */
export function interpretPlatformStatus(state: AccessState | null, now: number = Date.now()): PlatformStatus {
  if (!state) return 'unreachable'
  if (state.status === 'REVOKED') return 'revoked'
  if (state.status === 'ACTIVE') {
    const heartbeatMs = Date.parse(state.lastHeartbeatAt ?? '')
    if (Number.isFinite(heartbeatMs) && now - heartbeatMs < HEARTBEAT_FRESH_MS) return 'ok'
    return 'stale'
  }
  return 'inactive'
}

/** 五档状态的徽章文案与语义类（绿=ok 黄=warn 红=error 灰=neutral） */
export function statusBadge(status: PlatformStatus): PlatformStatusBadge {
  switch (status) {
    case 'ok':
      return { label: '平台已连接', badgeClass: 'ok' }
    case 'stale':
      return { label: '心跳超时', badgeClass: 'warn' }
    case 'revoked':
      return { label: '实例已被平台撤销', badgeClass: 'error' }
    case 'inactive':
      return { label: '未激活', badgeClass: 'neutral' }
    case 'unreachable':
      return { label: '平台连接不可达', badgeClass: 'error' }
  }
}

/**
 * 告警条文案（顶栏下沿红色横条，仅此两态渲染；ok/stale/inactive 返回 null）。
 * unreachable 措辞是功能影响提示而非降级动作（D-032）；revoked 给出联系管理员的指引。
 */
export function alertBanner(status: PlatformStatus): string | null {
  if (status === 'unreachable') return '平台连接不可达：功能暂时不可用（正在重试）'
  if (status === 'revoked') return '实例已被平台撤销，请联系管理员'
  return null
}
