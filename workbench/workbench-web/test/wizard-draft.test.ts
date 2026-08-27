// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { slugify } from '../src/composables/useWizardDraft'

/**
 * slugify 表驱动（L1 员工新建线 Task 14）：
 * - 小写化 + `[^a-z0-9]+→-` + 去首尾 `-`；
 * - 空字符串 / 纯 CJK / 全非字母数字 → 兜底 `employee`；
 * - ≤32 字符（截断到首个完整 token 边界，避免中段悬挂 `-`）。
 */

describe('slugify 表驱动', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['Frontend Dev!', 'frontend-dev'],
    ['frontend-dev', 'frontend-dev'],
    ['  Frontend   Dev  ', 'frontend-dev'],
    ['前端开发', 'employee'], // 纯 CJK 兜底
    ['', 'employee'], // 空兜底
    ['!!!', 'employee'], // 全非字母数字兜底
    ['a b c', 'a-b-c'],
    ['FrontendDev', 'frontenddev'], // 驼峰无分隔也连写
    ['Dev-100', 'dev-100'],
    ['A'.repeat(40), 'a'.repeat(32)], // 32 截断
  ]

  for (const [input, expected] of cases) {
    it(`slugify(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      expect(slugify(input)).toBe(expected)
    })
  }
})

describe('slugify 截断边界', () => {
  it('32 字符内不截断', () => {
    expect(slugify('a'.repeat(32)).length).toBe(32)
  })

  it('超长截断到 ≤32 且不以 - 结尾（去尾 -）', () => {
    const out = slugify('a'.repeat(50))
    expect(out.length).toBeLessThanOrEqual(32)
    expect(out.endsWith('-')).toBe(false)
  })
})
