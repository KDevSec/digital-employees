import { z } from 'zod'
import { brand } from '../brand'

/**
 * 平台地址 URL 校验（I0-5 T8，设计 D-14）。
 * 取舍：z.string().url() 收任意 scheme（ftp:// 等合法 URL 均过），平台通信只走 http(s)——
 * 叠 refine 限 http/https 开头（大小写不敏感：new URL 对 scheme 做小写规范化，HTTP:// 也是合法输入）。
 * GET/PUT 端点（routes/config.ts 的 body 校验）与 loadConfig 共用本判据——schema 单源，两处不漂移。
 */
export const httpBaseUrl = z
  .string()
  .url('平台地址必须是合法 URL')
  .refine((value) => /^https?:\/\//i.test(value), { message: '平台地址必须以 http:// 或 https:// 开头' })

/**
 * 平台地址取值：空串 = 未配置，非空须合法 http(s) URL（D-049，2026-08-27 用户裁决）。
 * 默认空串 = 开发环境（原 T8 默认 http://127.0.0.1:18000 废止——「本地不配置远程地址即开发环境」）。
 * 空串经 z.literal('') 放行（不走 URL 校验）；PUT 清除配置落盘的也是空串，两形态语义一致。
 */
export const platformBaseUrl = z.union([z.literal(''), httpBaseUrl])

/**
 * config.json 基础设施配置（S-07 简版）。
 * 严格 schema：未知键报错；文件只写覆盖项，未写的键走代码默认（设计 §5）。
 */
export const configSchema = z
  .object({
    network: z
      .object({
        port: z.number().int().min(1).max(65535).default(brand.defaultPort),
      })
      .strict()
      .default({ port: brand.defaultPort }),
    // I0-5 T8（设计 D-13）：管控平台地址——基础设施层配置（影响平台发现与更新源），不进 settings.json（用户偏好层）
    platform: z
      .object({
        baseUrl: platformBaseUrl,
        // 内网自签证书试点开关（022）：true = 出站 HTTPS 跳过证书校验；默认 false（安全默认）。
        insecureTls: z.boolean().default(false),
      })
      .strict()
      .default({ baseUrl: '', insecureTls: false }),
    // 024：终端心跳间隔（秒）。配置文件可调（局域网规模/实时性权衡）；
    // 范围 30–600，非法值由 loadConfig 回退默认 60。平台侧离线阈值在管理平台「设置-运行时」配置。
    heartbeat: z
      .object({
        intervalSeconds: z.number().int().min(30).max(600).default(60),
      })
      .strict()
      .default({ intervalSeconds: 60 }),
  })
  .strict()

export type WorkbenchConfig = z.infer<typeof configSchema>

/** 默认值单一来源：由 schema 推导（schema 改默认即生效，避免双来源漂移） */
export const defaultConfig: WorkbenchConfig = configSchema.parse({})

/**
 * 开发环境单一判据（D-049）：平台地址未配置 = 开发环境。
 * 消费方：routes/session.ts（/api/state 开发态桥接）、routes/config.ts（devEnvironment 回显）；
 * A 系列（认证后端迁移）落地后，服务端会话 guard 按同一判据注入开发身份——判据只此一处，不漂移。
 */
export function isDevPlatformBaseUrl(baseUrl: string): boolean {
  return baseUrl === ''
}

/** 便捷封装：整份配置 → 是否开发环境 */
export function isDevEnvironment(cfg: WorkbenchConfig): boolean {
  return isDevPlatformBaseUrl(cfg.platform.baseUrl)
}
