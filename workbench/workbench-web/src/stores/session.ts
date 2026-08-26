import { defineStore } from 'pinia'

import { fetchAccessState, type AccessState } from '../api/access'

/**
 * 会话 store 骨架（I0-5 T2，设计 D-7）：T3 登录态路由守卫的消费方——
 * 守卫启动拉一次 /api/state，未认证访问非 '/' 重定向 '/'（fetch 失败按未认证处理）。
 * T10（D-24/D-25）起消费方 = 设置浮层 SettingsPanel（用户组/平台状态 tag 展示、退出
 * 动作刷新）与 AlertBar（告警条），均只读 accessState 不轮询——TopBar 的 30s 周期刷新
 * 随其退役，数据更新点 = 守卫首次导航拉取 + 退出登录动作刷新（A 系列服务端心跳落地后
 * 如需恢复周期刷新在此扩展）。loaded 门闩只拦守卫「首次导航拉一次」，后续 fetchState
 * 不重置门闩也不影响守卫判定路径（守卫只在 !loaded 时 await fetchState；刷新失败归一
 * null 后用户再导航，按 D-7「失败按未认证」重定向 '/'，与不可达语义自洽）。
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    accessState: null as AccessState | null,
    /** 是否已完成首次拉取（区分「未加载」与「加载到未登录态」） */
    loaded: false,
  }),
  getters: {
    /** fetch 失败归一 null → 未认证（保守默认，D-7） */
    authenticated: (state): boolean => state.accessState?.authenticated ?? false,
  },
  actions: {
    async fetchState(): Promise<void> {
      this.accessState = await fetchAccessState()
      this.loaded = true
    },
  },
})
