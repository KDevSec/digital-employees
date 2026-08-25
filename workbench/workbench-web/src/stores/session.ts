import { defineStore } from 'pinia'

import { fetchAccessState, type AccessState } from '../api/access'

/**
 * 会话 store 骨架（I0-5 T2，设计 D-7）：T3 登录态路由守卫的消费方——
 * 守卫启动拉一次 /api/state，未认证访问非 '/' 重定向 '/'（fetch 失败按未认证处理）。
 * 本任务只立骨架：AccessView 自管页面级状态，守卫接线是 T3 的事。
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
