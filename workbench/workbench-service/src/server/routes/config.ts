/**
 * config 域路由（I0-5 T8，设计 D-14：平台地址配置端点，方案 A）。
 * GET/PUT /api/config/platform —— config.json `platform.baseUrl` 的读/写覆盖（D-13 存储位）。
 * - GET handler 每次经 loadConfig 重读文件（PUT 后立即可见，不缓存）；
 * - PUT zod 校验（判据与 loadConfig 同源 schema.httpBaseUrl：合法 URL + http(s) scheme），
 *   合法则 writeConfigOverride 覆盖写（只落覆盖键、保留既有键），回显新值；
 * - 错误形状 { error: { code, message } }：沿 demo PlatformError 错误处理器形状——
 *   web 侧 api/access.ts postAction 已按 error.message 消费同款形状，前端免适配。
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz 同档「无鉴权」；本机边界 = S-12
 * 仅绑 127.0.0.1 + Host 白名单守卫（adapter 层先于 handler 拦截）。
 * A 系列鉴权中间件落地后本域升「会话」档（详设 §10.2 settings 行同档规划）。
 * 消费边界（D-18）：本线只存不消费——登录/enrollment 读该地址属 A-01（G-1 已档）。
 */
import { z } from 'zod'
import { httpBaseUrl } from '../../config/schema'
import type { WorkbenchConfig } from '../../config/schema'
import type { ConfigOverrides } from '../../config/load'
import type { Ctx, Res, RouteRegistry } from '../registry'

/** PUT body：{ baseUrl: 合法 http(s) URL }（strict——多余键拒绝；判据与 loadConfig 同源） */
const platformPutSchema = z.object({ baseUrl: httpBaseUrl }).strict()

/** 错误码（沿 demo PlatformError code 命名风格） */
const INVALID_PLATFORM_URL = 'INVALID_PLATFORM_URL'

/**
 * config 域依赖：profile 目录 + 读写函数注入（域文件不 import 具体实现，与 infra/shell 同款注入模式；
 * main 装配真实实现，测试注入真实文件 IO 或桩）。
 */
export interface ConfigRouteDeps {
  /** profile 目录（config.json 所在地；GET/PUT 均按此路径读写） */
  profileDir: string
  /** 读配置（GET 每次重读：PUT 后立即可见） */
  loadConfig: (profileDir: string) => WorkbenchConfig
  /** 覆盖写（读现文件→深合并覆盖键→原子写，保留既有键——D-13） */
  writeConfigOverride: (profileDir: string, overrides: ConfigOverrides) => void
}

/** GET /api/config/platform —— 当前平台地址（D-13/D-14）。 */
export function platformConfigGetHandler(deps: ConfigRouteDeps) {
  return (_ctx: Ctx): Res => ({
    status: 200,
    json: { baseUrl: deps.loadConfig(deps.profileDir).platform.baseUrl },
  })
}

/** PUT /api/config/platform —— zod 校验（非法 400）→ 覆盖写（D-13）→ 回显新值。 */
export function platformConfigPutHandler(deps: ConfigRouteDeps) {
  return (ctx: Ctx): Res => {
    const parsed = platformPutSchema.safeParse(ctx.body)
    if (!parsed.success) {
      return {
        status: 400,
        json: {
          error: {
            code: INVALID_PLATFORM_URL,
            message: parsed.error.issues[0]?.message ?? '平台地址不合法',
          },
        },
      }
    }
    deps.writeConfigOverride(deps.profileDir, { platform: { baseUrl: parsed.data.baseUrl } })
    return { status: 200, json: { baseUrl: parsed.data.baseUrl } }
  }
}

/** config 域注册（只注册本域端点；汇总见 routes/index.ts）。 */
export function registerConfigRoutes(reg: RouteRegistry, deps: ConfigRouteDeps): void {
  reg.get('/api/config/platform', platformConfigGetHandler(deps))
  reg.put('/api/config/platform', platformConfigPutHandler(deps))
}
