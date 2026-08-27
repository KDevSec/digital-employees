import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { manifestSchema, skillFrontmatterSchema } from '../src'

// TPL_ROOT = workbench/templates（相对于本测试文件：test/ → shared-protocol/ → workbench/）
const TPL_ROOT = fileURLToPath(new URL('../../templates/', import.meta.url))

describe('活样例：模板物料过 v0.2 schema', () => {
  const dirs = readdirSync(TPL_ROOT).filter((d) =>
    statSync(join(TPL_ROOT, d)).isDirectory(),
  )

  it('七模板目录在位', () => {
    expect(dirs.length).toBe(7)
    // 显式列出预期七员，防止误把临时目录计入
    expect(dirs.sort()).toEqual(
      [
        'dev-engineer',
        'req-clarifier',
        'reviewer-expert',
        'sec-code',
        'sec-compliance',
        'sec-design',
        'sys-engineer',
      ].sort(),
    )
  })

  for (const dir of dirs) {
    it(`${dir}/manifest.yml 过 schema`, () => {
      const m = manifestSchema.parse(
        yaml.load(readFileSync(join(TPL_ROOT, dir, 'manifest.yml'), 'utf8')),
      )
      // skills 声明-实物一致：manifest.skills 每条在 skills/<name>/SKILL.md 有实物
      // （sec 三员 skills: [] 时循环零次天然过——属预期，不误报）
      for (const s of m.skills) {
        expect(existsSync(join(TPL_ROOT, dir, 'skills', s.name, 'SKILL.md'))).toBe(
          true,
        )
      }
    })

    it(`${dir} 的每份 SKILL.md frontmatter 过 schema`, () => {
      const skillsDir = join(TPL_ROOT, dir, 'skills')
      if (!existsSync(skillsDir)) return // sec 三员无 skills/ 目录——属预期
      for (const s of readdirSync(skillsDir)) {
        const raw = readFileSync(join(skillsDir, s, 'SKILL.md'), 'utf8')
        // frontmatter：首行 --- 与第二段 --- 之间的 yaml
        const fm = raw.split(/^---\s*$/m)[1] ?? ''
        const parsed = yaml.load(fm) as unknown
        const r = skillFrontmatterSchema.safeParse(parsed)
        if (!r.success) {
          throw new Error(
            `${dir}/${s}: ${r.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
          )
        }
      }
    })
  }
})
