import { describe, expect, it } from 'vitest'

import type { AccessState } from '../src/api/access'
import { alertBanner, HEARTBEAT_FRESH_MS, interpretPlatformStatus, statusBadge } from '../src/api/platform-status'

/**
 * F-04 顶栏平台状态纯函数（I0-5 T4，设计 §3 尾段「F-04 顶栏数据源」）：
 * interpretPlatformStatus 把 /api/state 消费结果（AccessState，fetchAccessState 失败已归一 null）
 * 压成五档展示状态；statusBadge 是徽章文案/语义类映射；alertBanner 只在
 * unreachable/revoked 出告警文案（D-032 提示而非降级——告警条只提示，不锁功能）。
 * node 纯逻辑环境（D-10 环境分流），时间基准经 now 参数注入（缺省 Date.now）。
 */

/** 固定时间基准：边界用例（恰好 90s / 90s-1ms）不依赖墙钟 */
const NOW = 1_760_000_000_000

function stateOf(partial: Partial<AccessState>): AccessState {
  return { installationId: 'inst-001', status: 'ACTIVE', authenticated: true, ...partial }
}

describe('interpretPlatformStatus（AccessState → 五档平台状态）', () => {
  it('null（fetchAccessState 失败归一）→ unreachable', () => {
    expect(interpretPlatformStatus(null, NOW)).toBe('unreachable')
  })

  it('REVOKED → revoked（优先于心跳：已撤销实例即便残留新鲜心跳也按撤销告警）', () => {
    const revoked = stateOf({ status: 'REVOKED', lastHeartbeatAt: new Date(NOW - 1000).toISOString() })
    expect(interpretPlatformStatus(revoked, NOW)).toBe('revoked')
  })

  it('ACTIVE + 心跳新鲜（距今 30s < 90s）→ ok', () => {
    const fresh = stateOf({ lastHeartbeatAt: new Date(NOW - 30_000).toISOString() })
    expect(interpretPlatformStatus(fresh, NOW)).toBe('ok')
  })

  it('边界：心跳距今恰为 HEARTBEAT_FRESH_MS（90s）→ stale（新鲜判定用严格小于）', () => {
    const edge = stateOf({ lastHeartbeatAt: new Date(NOW - HEARTBEAT_FRESH_MS).toISOString() })
    expect(interpretPlatformStatus(edge, NOW)).toBe('stale')
  })

  it('边界：心跳距今 90s - 1ms → ok', () => {
    const justFresh = stateOf({ lastHeartbeatAt: new Date(NOW - HEARTBEAT_FRESH_MS + 1).toISOString() })
    expect(interpretPlatformStatus(justFresh, NOW)).toBe('ok')
  })

  it('ACTIVE 心跳缺失（lastHeartbeatAt undefined）→ stale', () => {
    expect(interpretPlatformStatus(stateOf({}), NOW)).toBe('stale')
  })

  it('ACTIVE 心跳非合法日期字符串 → stale（Date.parse NaN 视同缺失，不抛错）', () => {
    const bad = stateOf({ lastHeartbeatAt: 'not-a-date' })
    expect(interpretPlatformStatus(bad, NOW)).toBe('stale')
  })

  it.each(['NEW', 'PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'REJECTED', 'ERROR'] as const)(
    '%s（未激活各态）→ inactive（中性不告警）',
    (status) => {
      expect(interpretPlatformStatus(stateOf({ status, authenticated: false }), NOW)).toBe('inactive')
    },
  )

  it('now 缺省 → 默认 Date.now()（心跳按墙钟判定，无需注入）', () => {
    const fresh = stateOf({ lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString() })
    expect(interpretPlatformStatus(fresh)).toBe('ok')
  })
})

describe('statusBadge（五档状态的徽章文案与语义类：绿/黄/红/灰）', () => {
  it.each([
    ['ok', '平台已连接', 'ok'],
    ['stale', '心跳超时', 'warn'],
    ['revoked', '实例已被平台撤销', 'error'],
    ['inactive', '未激活', 'neutral'],
    ['unreachable', '平台连接不可达', 'error'],
  ] as const)('%s → %s / %s', (status, label, badgeClass) => {
    expect(statusBadge(status)).toEqual({ label, badgeClass })
  })
})

describe('alertBanner（告警条文案：仅 unreachable/revoked 非 null，D-032 提示而非降级）', () => {
  it('unreachable → 平台连接不可达告警文案（含功能影响提示措辞）', () => {
    const banner = alertBanner('unreachable')
    expect(banner).toContain('平台连接不可达')
    expect(banner).toContain('不可用')
  })

  it('revoked → 实例撤销告警文案（含联系管理员指引）', () => {
    const banner = alertBanner('revoked')
    expect(banner).toContain('实例已被平台撤销')
    expect(banner).toContain('请联系管理员')
  })

  it.each(['ok', 'stale', 'inactive'] as const)('%s → null（不渲染告警条）', (status) => {
    expect(alertBanner(status)).toBeNull()
  })
})
