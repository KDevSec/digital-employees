import { describe, expect, it } from 'vitest'

import { resolveRedirect } from '../src/router/guard'

/**
 * 守卫判定纯函数 resolveRedirect（I0-5 T3，设计 D-7）：
 * 未认证且目标 ≠ '/' → '/'（接入页是唯一未登录可达页，D-5）；
 * 其余（已认证任意路径 / 未认证但目标就是 '/'）→ null 放行。
 * 已登录访问 '/' 不跳转 = demo 语义（D-7 注：接入页登录后就是状态卡，不发明跳转）。
 * 纯函数无 DOM/网络依赖（node 环境直测）；矩阵覆盖三业务域 + 深链 + 登录态两轴。
 */

describe('resolveRedirect(authenticated, toPath) 判定矩阵', () => {
  it('未认证 × 三业务域路径 → 一律重定向 /', () => {
    expect(resolveRedirect(false, '/employees')).toBe('/')
    expect(resolveRedirect(false, '/bases')).toBe('/')
    expect(resolveRedirect(false, '/kanban')).toBe('/')
  })

  it('未认证 × 深链（含未定义的子路径）→ 同样重定向 /（守卫判定先于路由匹配，未知路径不放过）', () => {
    expect(resolveRedirect(false, '/employees/emp-1')).toBe('/')
    expect(resolveRedirect(false, '/kanban/run-42/stage/3')).toBe('/')
  })

  it('未认证 × 目标就是 / → null 放行（接入页常驻可达）', () => {
    expect(resolveRedirect(false, '/')).toBeNull()
  })

  it('已认证 × 任意路径 → null 放行（含 /：已登录访问接入页不跳转，demo 语义）', () => {
    expect(resolveRedirect(true, '/')).toBeNull()
    expect(resolveRedirect(true, '/employees')).toBeNull()
    expect(resolveRedirect(true, '/bases')).toBeNull()
    expect(resolveRedirect(true, '/kanban')).toBeNull()
    expect(resolveRedirect(true, '/employees/emp-1')).toBeNull()
  })
})
