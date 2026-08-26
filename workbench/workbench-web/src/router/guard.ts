import type { Router } from 'vue-router'

import type { AccessStatus } from '../api/access'
import { useSessionStore } from '../stores/session'

/**
 * 路由守卫（I0-5 T3 立项 D-5/D-7；T9 扩三参，设计 D-21 登录动线）：
 * - resolveRedirect 纯函数三参判定：
 *   · 未认证且目标 ≠ '/' → '/'（接入页是唯一未登录可达页）；
 *   · 已认证 + ACTIVE + 目标 '/' + **初始导航**（冷启动/登录落地）→ '/employees'（登录动线
 *     自动跳转，兑现 F-02「我的员工（默认）」）；SPA 内导航到 '/' 一律放行——D-22 顶栏
 *     「接入与平台设置」入口对 ACTIVE 用户有效（T9 审查修复：否则该入口被分流弹回，接入页
 *     与 T8 平台配置卡对 ACTIVE 用户永久不可达）；
 *   · 已认证 + 非 ACTIVE + 目标 '/' → null 放行（停接入页盯审批）；
 *   · 其余 → null 放行。status 为 undefined（accessState null，store 未加载完）时
 *     即便 authenticated 也不自动跳——防「看似已登录实则无状态」的误跳。
 * - setupRouterGuard 接线：首次导航（session.loaded 为 false）先拉一次 /api/state，
 *   之后每导航以 resolveRedirect 判定（authenticated, accessState?.status, to.path
 *   三参——accessState null 时 status 自然归 undefined）。fetch 失败由 store 归一
 *   未认证（fetchAccessState 归一 null → authenticated false，D-7「失败按未认证处理」）。
 *
 * store 取用姿势：router 模块顶层不取 store（模块加载时 pinia 未必激活），
 * 守卫回调内 useSessionStore()（app 侧 createPinia 安装后 active pinia 常驻；
 * 测试侧 setActivePinia 先装同一语义）。
 */

/** 守卫判定：返回重定向目标路径，null = 放行。
 * isInitialNavigation 默认 true——三参调用即登录落地语义（OIDC 回调整页加载 '/' 的冷启动首导航）；
 * 接线层以 vue-router from.matched 空（START location）判定初始导航，SPA 内导航显式传 false。 */
export function resolveRedirect(
  authenticated: boolean,
  status: AccessStatus | undefined,
  toPath: string,
  isInitialNavigation = true,
): string | null {
  if (!authenticated && toPath !== '/') return '/'
  // D-21 登录动线：ACTIVE 且目标是接入页且是登录落地（初始导航）→ 自动跳我的员工（默认落地页）
  if (isInitialNavigation && authenticated && status === 'ACTIVE' && toPath === '/') return '/employees'
  return null
}

/** 登录态守卫接线（router/index.ts 装配时调用一次） */
export function setupRouterGuard(router: Router): void {
  router.beforeEach(async (to, from) => {
    const session = useSessionStore()
    if (!session.loaded) {
      // 首次导航拉一次 /api/state；loaded 门闩置真后后续导航不再重复拉取
      await session.fetchState()
    }
    // 初始导航（冷启动/整页加载，from 为 START 无 matched 记录）→ 登录落地分流场景；
    // SPA 内导航（from 有 matched）→ 用户意图优先，不参与 ACTIVE 自动跳（T9 审查修复，见头注释）
    const isInitialNavigation = from.matched.length === 0
    const redirect = resolveRedirect(session.authenticated, session.accessState?.status, to.path, isInitialNavigation)
    // NavigationGuardReturn = void | Error | boolean | RouteLocationRaw（不含 null），null 放行语义转 undefined
    return redirect ?? undefined
  })
}
