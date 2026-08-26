import { describe, expect, it } from 'vitest'

import type { AccessStatus } from '../src/api/access'
import { resolveRedirect } from '../src/router/guard'

/**
 * 守卫判定纯函数 resolveRedirect（I0-5 T3 立项 D-7；T9 扩三参，设计 D-21 登录动线）：
 * - 未认证且目标 ≠ '/' → '/'（接入页是唯一未登录可达页，D-5）；
 * - 已认证 + ACTIVE + 目标 '/' → '/employees'（登录动线自动跳转，兑现 F-02「我的员工（默认）」；
 *   回调落 '/' 时守卫已有 state（首次导航已拉），直接按状态分流）；
 * - 已认证 + 非 ACTIVE + 目标 '/' → null 放行（停接入页盯审批）；
 * - 其余 → null 放行。
 * status 传 undefined（store accessState 为 null，如未加载完）时即便 authenticated 也不自动跳
 * （守卫接线 session.accessState?.status，null 时自然归 undefined——防「看似已登录实则无状态」的误跳）。
 * 纯函数无 DOM/网络依赖（node 环境直测）；矩阵覆盖三业务域 + 深链 + 认证态 × 状态两轴。
 */

/** 全状态集（矩阵枚举用；NEW~ERROR 七态 + ACTIVE 单列） */
const NON_ACTIVE_STATUSES: AccessStatus[] = [
  'NEW',
  'PENDING_REVIEW',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
  'REVOKED',
  'ERROR',
]

describe('resolveRedirect(authenticated, status, toPath) 判定矩阵（D-21 三参）', () => {
  it('未认证 × 三业务域路径 → 一律重定向 /', () => {
    expect(resolveRedirect(false, undefined, '/employees')).toBe('/')
    expect(resolveRedirect(false, undefined, '/bases')).toBe('/')
    expect(resolveRedirect(false, undefined, '/kanban')).toBe('/')
  })

  it('未认证 × 深链（含未定义的子路径）→ 同样重定向 /（守卫判定先于路由匹配，未知路径不放过）', () => {
    expect(resolveRedirect(false, undefined, '/employees/emp-1')).toBe('/')
    expect(resolveRedirect(false, undefined, '/kanban/run-42/stage/3')).toBe('/')
  })

  it('未认证（accessState 在场带状态）× 非 / → 照样重定向 /（未登录时状态值不参与放行判定）', () => {
    expect(resolveRedirect(false, 'ACTIVE', '/employees')).toBe('/')
    expect(resolveRedirect(false, 'NEW', '/kanban')).toBe('/')
  })

  it('未认证 × 目标就是 / → null 放行（接入页常驻可达）', () => {
    expect(resolveRedirect(false, undefined, '/')).toBeNull()
    expect(resolveRedirect(false, 'NEW', '/')).toBeNull()
  })

  it('已登录 ACTIVE × / × 初始导航（默认）→ /employees（D-21 登录落地自动跳转，F-02「我的员工（默认）」兑现）', () => {
    expect(resolveRedirect(true, 'ACTIVE', '/')).toBe('/employees')
    expect(resolveRedirect(true, 'ACTIVE', '/', true)).toBe('/employees')
  })

  it('已登录 ACTIVE × / × SPA 内导航（isInitialNavigation=false）→ null 放行（T9 审查修复：自动分流只属登录落地场景，D-22「接入与平台设置」入口可达性保障）', () => {
    expect(resolveRedirect(true, 'ACTIVE', '/', false)).toBeNull()
  })

  it('已登录 ACTIVE × 非 / → null 放行（业务页/深链正常直达）', () => {
    expect(resolveRedirect(true, 'ACTIVE', '/employees')).toBeNull()
    expect(resolveRedirect(true, 'ACTIVE', '/bases')).toBeNull()
    expect(resolveRedirect(true, 'ACTIVE', '/kanban')).toBeNull()
    expect(resolveRedirect(true, 'ACTIVE', '/employees/emp-1')).toBeNull()
  })

  it.each(NON_ACTIVE_STATUSES)('已登录非 ACTIVE（%s）× / → null 放行（停接入页盯审批）', (status) => {
    expect(resolveRedirect(true, status, '/')).toBeNull()
  })

  it('已登录非 ACTIVE × 业务路径 → null 放行（审批中也可进入已授权的业务骨架页）', () => {
    expect(resolveRedirect(true, 'PENDING_REVIEW', '/employees')).toBeNull()
    expect(resolveRedirect(true, 'REJECTED', '/bases')).toBeNull()
  })

  it('已登录但 status undefined（accessState null，store 未加载完）× / → null 不自动跳（D-21 时序护栏）', () => {
    expect(resolveRedirect(true, undefined, '/')).toBeNull()
  })
})
