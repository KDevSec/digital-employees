import { z } from 'zod'
import { brand } from '../brand'

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
  })
  .strict()

export type WorkbenchConfig = z.infer<typeof configSchema>

export const defaultConfig: WorkbenchConfig = { network: { port: brand.defaultPort } }
