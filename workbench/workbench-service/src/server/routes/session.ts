/**
 * session 域路由（D-049 开发环境桥接，2026-08-27 用户裁决）：GET /api/state。
 *
 * 背景：A 系列（认证后端 demo→service 迁移）未落地，/api/state 此前不存在——web 守卫
 * 拉不到状态一律按未认证（只能看接入页），本地无平台时前端调试被卡。D-049 裁决：
 * 平台地址未配置 = 开发环境——本端点注入开发态（authenticated + ACTIVE + 开发用户），
 * web 零改动全放行（顶栏/设置浮层显示「开发模式」用户）；已配置平台地址 = 生产语义 →
 * 401（web fetchAccessState 非 2xx 归一 null → 未认证，与「端点不存在」的现行行为等价，
 * 登录链路等 A 系列迁移）。
 *
 * 响应形状 = demo /api/state 的消费子集（web api/access.ts parseStateJson 契约）：
 * installationId 必须字符串（整包拒绝判据）、status 八枚举、authenticated === true 才认证。
 * A 系列落地后本域升级为真实会话端点（OIDC/会话/心跳），开发环境语义沿用
 * schema.isDevEnvironment 同一判据（guard 注入开发身份），本文件的开发态桥接届时退役。
 */
import { isDevEnvironment } from '../../config/schema'
import type { WorkbenchConfig } from '../../config/schema'
import type { Ctx, Res, RouteRegistry } from '../registry'

/** session 域依赖：profile 目录 + 读配置注入（与 config 域同款注入模式） */
export interface SessionRouteDeps {
  /** profile 目录（config.json 所在地；判据 = platform.baseUrl） */
  profileDir: string
  /** 读配置（每次重读：PUT 平台地址后立即切换语义） */
  loadConfig: (profileDir: string) => WorkbenchConfig
}

/** GET /api/state —— 开发环境注入开发态；生产语义 401（D-049）。 */
export function stateGetHandler(deps: SessionRouteDeps) {
  return (_ctx: Ctx): Res => {
    const dev = isDevEnvironment(deps.loadConfig(deps.profileDir))
    if (!dev) {
      return {
        status: 401,
        json: {
          error: {
            code: 'NO_SESSION',
            message: '未登录——已配置平台地址（生产语义），登录链路随 A 系列迁移提供',
          },
        },
      }
    }
    return {
      status: 200,
      json: {
        installationId: 'dev',
        status: 'ACTIVE',
        authenticated: true,
        user: { name: '开发模式', preferred_username: 'dev', email: 'dev@localhost' },
      },
    }
  }
}

/** session 域注册（只注册本域端点；汇总见 routes/index.ts）。 */
export function registerSessionRoutes(reg: RouteRegistry, deps: SessionRouteDeps): void {
  reg.get('/api/state', stateGetHandler(deps))
}
