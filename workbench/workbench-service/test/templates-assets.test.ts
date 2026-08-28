import { it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { builtinTemplates } from '../src/assets/templates.gen'

// workbench/templates（相对 service/test：上两级到 workbench/，再进 templates/）
const TPL_ROOT = join(__dirname, '..', '..', 'templates')

/**
 * 模板资产 codegen drift 守卫（Task 6 / B1）：
 * src/assets/templates.gen.ts 由 `bun run gen:templates` 扫 workbench/templates/ 生成，
 * 提交进仓沿 web-dist/index.html 先例（bun --compile 单体编译期嵌入源）。
 * 任何人改物料未重跑 gen，pretest 钩子先重跑 gen，否则此测试在 CI/本地都会红。
 */
it('gen 与 templates/ 实际文件零 drift（改物料未重跑 gen 即红）', () => {
  const actual = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) {
        walk(p)
      } else {
        actual.add(relative(TPL_ROOT, p).split('\\').join('/'))
      }
    }
  }
  walk(TPL_ROOT)

  const genKeys = new Set(Object.keys(builtinTemplates))
  expect(genKeys).toEqual(actual)

  for (const [k, v] of Object.entries(builtinTemplates)) {
    expect(v).toBe(readFileSync(join(TPL_ROOT, k), 'utf8'))
  }
})

it('七个员工模板目录齐 + manifest 在位（每员工根 manifest.yml）', () => {
  const manifests = Object.keys(builtinTemplates).filter((k) => k.endsWith('manifest.yml'))
  expect(manifests.length).toBe(7)
  // 七员工清单（与 workbench/templates/README.md 一致）
  const expectedEmployees = [
    'dev-engineer',
    'req-clarifier',
    'reviewer-expert',
    'sec-code',
    'sec-compliance',
    'sec-design',
    'sys-engineer',
  ]
  for (const emp of expectedEmployees) {
    expect(builtinTemplates[`${emp}/manifest.yml`]).toBeDefined()
  }
})

it('gen 产物键序稳定——重跑 gen 两次结果零 diff（diff 干净是评审硬线）', () => {
  // 此测试不能直接调 gen 脚本（会改文件），改为校验键已按字典升序排列
  const keys = Object.keys(builtinTemplates)
  const sorted = [...keys].sort()
  expect(keys).toEqual(sorted)
})
