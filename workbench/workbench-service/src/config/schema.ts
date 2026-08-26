import { z } from 'zod'
import { brand } from '../brand'

/** 平台地址默认值（I0-5 T8，设计 D-13：与 demo 平台一致；安装器预填覆盖键的机制见 D-17） */
export const DEFAULT_PLATFORM_BASE_URL = 'http://127.0.0.1:18000'

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
        baseUrl: httpBaseUrl,
      })
      .strict()
      .default({ baseUrl: DEFAULT_PLATFORM_BASE_URL }),
  })
  .strict()

export type WorkbenchConfig = z.infer<typeof configSchema>

/** 默认值单一来源：由 schema 推导（schema 改默认即生效，避免双来源漂移） */
export const defaultConfig: WorkbenchConfig = configSchema.parse({})
