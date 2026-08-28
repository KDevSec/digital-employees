// 结构化校验出口：把 zod safeParse 的 issues 折成点连 path + 字符串 code 的扁平结构
// 消费方（hooks.json 校验门 / 工作台安装期校验）只关心 valid 与 issues，不感知 zod 类型。
import { manifestSchema } from './manifest'

export interface ValidationIssue {
  path: string
  code: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

/**
 * validateManifest：未知输入 → 结构化校验结果
 *  - 成功：{ valid: true, issues: [] }
 *  - 失败：把 zod issues 的 path（string|number 数组）折成点连字符串
 *         code 取 zod issue code（string 字面量类型，运行时即字符串）
 *         message 取 zod issue message
 *  例：path ['requires','level'] → 'requires.level'
 *      path ['connectors',0,'command'] → 'connectors.0.command'
 */
export function validateManifest(input: unknown): ValidationResult {
  const r = manifestSchema.safeParse(input)
  if (r.success) {
    return { valid: true, issues: [] }
  }
  return {
    valid: false,
    issues: r.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    })),
  }
}
