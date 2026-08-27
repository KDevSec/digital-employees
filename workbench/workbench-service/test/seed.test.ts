/**
 * seed 预置物化（Task 18 / D2）：首启 7 模板走同一 E-12 管线进员工库。
 *
 * 注入隔离 tmp：employeesRoot/tmpRoot/customRoot 都在 mkdtempSync 目录。
 * 不依赖 fs 真实 HOME —— 与 employees-builder.test.ts 同手法。
 *
 * 测试覆盖：
 *  ① 首跑 7 目录齐 + 每目录 manifest.yml 过 manifestSchema + operator=占位
 *  ② 二跑全 skipped（目录数不变）—— 幂等语义
 *  ③ 同构断言：同一 draft 走「seedBuiltinEmployees」与「builder.generate 直调」产出目录树一致
 *  ④ store.exists 时跳过（不调 builder.generate）—— 幂等跳过路径断言
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { manifestSchema, parseSkillFrontmatter } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import { createEmployeeStore } from '../src/employees/store'
import { createEmployeeBuilder, type EmployeeDraft } from '../src/employees/builder'
import { seedBuiltinEmployees } from '../src/employees/seed'

let base: string
let employeesRoot: string
let tmpRoot: string
let customRoot: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wb-seed-'))
  employeesRoot = join(base, 'employees')
  tmpRoot = join(base, 'tmp')
  customRoot = join(base, 'templates-custom')
})

function setup() {
  const provider = createTemplatesProvider(builtinTemplates, customRoot)
  const store = createEmployeeStore(employeesRoot, tmpRoot)
  const builder = createEmployeeBuilder({ provider, store, tmpRoot })
  return { provider, store, builder }
}

/** 7 个 builtin 模板 id（与 builtinTemplates 键序一致） */
const BUILTIN_IDS = [
  'dev-engineer',
  'req-clarifier',
  'reviewer-expert',
  'sec-code',
  'sec-compliance',
  'sec-design',
  'sys-engineer',
].sort()

/** 收集目录下所有文件（相对路径，forward slash） */
function collectFiles(dir: string): string[] {
  const out: string[] = []
  walk(dir, '', out)
  return out
}

function walk(root: string, rel: string, out: string[]): void {
  const abs = rel === '' ? root : join(root, rel)
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      walk(root, childRel, out)
    } else if (entry.isFile()) {
      out.push(childRel)
    }
  }
}

describe('seedBuiltinEmployees — 首启物化', () => {
  it('① 首跑：7 模板都进 employeesRoot，每 manifest 过 schema，operator=占位', async () => {
    const { provider, store, builder } = setup()
    const result = await seedBuiltinEmployees(provider, store, builder)

    expect(result.seeded.sort()).toEqual(BUILTIN_IDS)
    expect(result.skipped).toEqual([])

    // 目录数 = 7
    const dirs = readdirSync(employeesRoot).sort()
    expect(dirs).toEqual(BUILTIN_IDS)

    // 每个目录的 manifest.yml 过 schema + operator=占位
    for (const id of result.seeded) {
      const manifestPath = join(employeesRoot, id, 'manifest.yml')
      expect(existsSync(manifestPath), `${id}/manifest.yml 应存在`).toBe(true)
      const manifestText = readFileSync(manifestPath, 'utf8')
      const doc = yaml.load(manifestText)
      const r = manifestSchema.safeParse(doc)
      expect(r.success, `${id} manifest 应过 schema`).toBe(true)
      if (r.success) {
        expect(r.data.operator, `${id} operator 应为占位邮箱`).toBe('demo@devzero.local')
      }
    }
  })

  it('② 二跑：全 skipped，目录数不变（幂等语义）', async () => {
    const { provider, store, builder } = setup()
    // 首跑
    const r1 = await seedBuiltinEmployees(provider, store, builder)
    expect(r1.seeded.length).toBe(7)
    expect(r1.skipped).toEqual([])

    const dirsAfterFirst = readdirSync(employeesRoot).sort()

    // 二跑
    const r2 = await seedBuiltinEmployees(provider, store, builder)
    expect(r2.seeded).toEqual([])
    expect(r2.skipped.sort()).toEqual(BUILTIN_IDS)

    // 目录数不变
    const dirsAfterSecond = readdirSync(employeesRoot).sort()
    expect(dirsAfterSecond).toEqual(dirsAfterFirst)
  })

  it('③ 同构断言：seed 与 builder.generate 直调产出目录树一致（dev-engineer，文件集合 + 内容）', async () => {
    // Path A: seedBuiltinEmployees 全量 → 取 dev-engineer 目录
    const baseA = mkdtempSync(join(tmpdir(), 'wb-seed-iso-a-'))
    const storeA = createEmployeeStore(join(baseA, 'employees'), join(baseA, 'tmp'))
    const providerA = createTemplatesProvider(builtinTemplates, join(baseA, 'custom'))
    const builderA = createEmployeeBuilder({
      provider: providerA,
      store: storeA,
      tmpRoot: join(baseA, 'tmp'),
    })
    await seedBuiltinEmployees(providerA, storeA, builderA)
    const dirA = join(baseA, 'employees', 'dev-engineer')
    expect(existsSync(dirA), 'Path A dev-engineer 目录应在位').toBe(true)

    // Path B: 手动构造 draft（模拟向导产物，与 seed 内部构造同源）+ builder.generate 直调
    const baseB = mkdtempSync(join(tmpdir(), 'wb-seed-iso-b-'))
    const storeB = createEmployeeStore(join(baseB, 'employees'), join(baseB, 'tmp'))
    const providerB = createTemplatesProvider(builtinTemplates, join(baseB, 'custom'))
    const builderB = createEmployeeBuilder({
      provider: providerB,
      store: storeB,
      tmpRoot: join(baseB, 'tmp'),
    })

    // 手动构造 dev-engineer draft —— 与 seed 内部 buildDraftFromTemplate 同源逻辑
    const manifestText = builtinTemplates['dev-engineer/manifest.yml']!
    const manifest = manifestSchema.parse(yaml.load(manifestText)) as Manifest
    manifest.operator = 'demo@devzero.local' // 占位（与 seed 默认一致）
    const skills: EmployeeDraft['skills'] = manifest.skills.map((s) => {
      let description = ''
      const skillMdText = builtinTemplates[`dev-engineer/skills/${s.name}/SKILL.md`]
      if (skillMdText) {
        const r = parseSkillFrontmatter(skillMdText)
        if (r.ok) {
          description = r.value.description
        }
      }
      const draftSkill: {
        name: string
        version: string
        source_type: 'template' | 'local'
        template_id?: string
        description: string
      } = {
        name: s.name,
        version: s.version,
        source_type: s.source_type,
        description,
      }
      if (s.source_type === 'template') {
        draftSkill.template_id = 'dev-engineer'
      }
      return draftSkill
    })
    await builderB.generate({ manifest, skills })
    const dirB = join(baseB, 'employees', 'dev-engineer')
    expect(existsSync(dirB), 'Path B dev-engineer 目录应在位').toBe(true)

    // 比较两目录树（文件集合 + 内容）
    const filesA = collectFiles(dirA).sort()
    const filesB = collectFiles(dirB).sort()
    expect(filesA, '文件集合应一致').toEqual(filesB)
    for (const f of filesA) {
      const contentA = readFileSync(join(dirA, f), 'utf8')
      const contentB = readFileSync(join(dirB, f), 'utf8')
      expect(contentA, `文件 ${f} 内容应一致`).toBe(contentB)
    }
  })

  it('④ store.exists 时跳过（不调 builder.generate）—— 幂等跳过路径断言', async () => {
    const { provider, store, builder } = setup()
    // 手动创建 dev-engineer 目录（让 store.exists 返回 true）
    mkdirSync(join(employeesRoot, 'dev-engineer'), { recursive: true })

    const result = await seedBuiltinEmployees(provider, store, builder)

    // dev-engineer 应被 skipped（不调 builder.generate）
    expect(result.skipped).toContain('dev-engineer')
    expect(result.seeded).not.toContain('dev-engineer')
    // 其余 6 个 seeded
    expect(result.seeded.length).toBe(6)
    // dev-engineer 目录里应只有我们手动创建的空内容（无 manifest.yml/AGENTS.md）
    expect(readdirSync(join(employeesRoot, 'dev-engineer'))).toEqual([])
  })
})
