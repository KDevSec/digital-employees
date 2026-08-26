import type { Router } from 'vue-router'

import { useSessionStore } from '../stores/session'

/**
 * 路由守卫（I0-5 T3，设计 D-5/D-7）：
 * - resolveRedirect 纯函数：未认证且目标 ≠ '/' → '/'（接入页是唯一未登录可达页）；
 *   其余放行 null。已登录访问 '/' 不跳转（demo 语义：接入页登录后就是状态卡，不发明跳转）；
 * - setupRouterGuard 接线：首次导航（session.loaded 为 false）先拉一次 /api/state，
 *   之后每导航以 resolveRedirect 判定。fetch 失败由 store 归一未认证
 *   （fetchAccessState 归一 null → authenticated false，D-7「失败按未认证处理」）。
 *
 * store 取用姿势：router 模块顶层不取 store（模块加载时 pinia 未必激活），
 * 守卫回调内 useSessionStore()（app 侧 createPinia 安装后 active pinia 常驻；
 * 测试侧 setActivePinia 先装同一语义）。
 */

/** 守卫判定：返回重定向目标路径，null = 放行 */
export function resolveRedirect(authenticated: boolean, toPath: string): string | null {
  if (!authenticated && toPath !== '/') return '/'
  return null
}

/** 登录态守卫接线（router/index.ts 装配时调用一次） */
export function setupRouterGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const session = useSessionStore()
    if (!session.loaded) {
      // 首次导航拉一次 /api/state；loaded 门闩置真后后续导航不再重复拉取
      await session.fetchState()
    }
    const redirect = resolveRedirect(session.authenticated, to.path)
    // NavigationGuardReturn = void | Error | boolean | RouteLocationRaw（不含 null），null 放行语义转 undefined
    return redirect ?? undefined
  })
}
