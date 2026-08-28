/**
 * builder 管线八步（Task 11 / B6）：draft → generate → 员工包目录树。
 *
 * 数据源：builtinTemplates 内存 Record（不依赖 fs，覆盖 codegen 产物）。
 * 注入隔离 tmp HOME：employeesRoot/tmpRoot 在 beforeEach mkdtemp 下，与生产 profileDir 完全隔离。
 *
 * 测试覆盖：
 *  ① 真 draft（dev-engineer 从 builtinTemplates 解析 + skills 描述清单）→ generate → 断言员工目录树
 *     （manifest.yml/AGENTS.md/skills/×5/hooks/hooks.json/orchestration/...）、产物 manifest.yml 重新 yaml load 后过 manifestSchema、无 mcp.json
 *  ② local skill 缺 temp → SkillMissingError
 *  ③ id 冲突 → EmployeeIdConflictError
 *  ④ 坏 draft（改坏 display）→ DraftValidationError 且 issues 携带 path
 *  ⑤ template_id 注入断言（draft 不带 → 产物 manifest.yml 里有）
 *  + 目录边界：generate 全程只写注入的 employeesRoot/tmpRoot
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { manifestSchema } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import {
  createEmployeeStore,
  EmployeeIdConflictError,
} from '../src/employees/store'
import {
  createEmployeeBuilder,
  DraftValidationError,
  SkillMissingError,
  type EmployeeDraft,
  type GenerateResult,
} from '../src/employees/builder'

let base: string
let employeesRoot: string
let tmpRoot: string
let customRoot: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wb-emp-builder-'))
  employeesRoot = join(base, 'employees')
  tmpRoot = join(base, 'tmp')
  customRoot = join(base, 'templates-custom')
})

/** 解析 builtinTemplates['<tplId>/manifest.yml'] → Manifest（schema parse） */
function parseManifest(tplId: string): Manifest {
  const text = builtinTemplates[`${tplId}/manifest.yml`]
  if (text === undefined) throw new Error(`manifest.yml 缺失：${tplId}`)
  const doc = yaml.load(text)
  return manifestSchema.parse(doc) as Manifest
}

/** 组装 dev-engineer draft：manifest 从 builtinTemplates 解析；skills 描述清单（带 template_id） */
function buildDevEngineerDraft(opts: { stripTemplateId?: boolean } = {}): EmployeeDraft {
  const manifest = parseManifest('dev-engineer')
  // 深拷贝避免污染缓存（manifest 是 schema parse 的产物，安全起见复制一份）
  const draftManifest = JSON.parse(JSON.stringify(manifest)) as Manifest
  const skills = draftManifest.skills.map((s) => {
    const skill: {
      name: string
      version: string
      source_type: 'template'
      template_id?: string
      description: string
    } = {
      name: s.name,
      version: s.version,
      source_type: 'template',
      description: '',
    }
    if (!opts.stripTemplateId) {
      skill.template_id = 'dev-engineer'
    }
    return skill
  })
  return { manifest: draftManifest, skills }
}

function buildBuilder() {
  const provider = createTemplatesProvider(builtinTemplates, customRoot)
  const store = createEmployeeStore(employeesRoot, tmpRoot)
  return createEmployeeBuilder({ provider, store, tmpRoot })
}

describe('createEmployeeBuilder.generate — 真 draft 全链（dev-engineer）', () => {
  it('① generate → 员工目录树齐全 + manifest 复验过 schema + 无 mcp.json', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft()
    const result: GenerateResult = await builder.generate(draft)

    // package_path 指向注入的 employeesRoot/<id>/
    expect(result.package_path).toBe(join(employeesRoot, draft.manifest.id))
    expect(existsSync(result.package_path)).toBe(true)

    // 目录树断言：必备文件在位
    const pkg = result.package_path
    expect(existsSync(join(pkg, 'manifest.yml'))).toBe(true)
    expect(existsSync(join(pkg, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(pkg, 'hooks', 'hooks.json'))).toBe(true)
    expect(existsSync(join(pkg, 'orchestration', 'dev-engineer.node-table.yml'))).toBe(true)
    // 5 个 skill 目录齐
    for (const s of draft.manifest.skills) {
      expect(existsSync(join(pkg, 'skills', s.name, 'SKILL.md'))).toBe(true)
    }
    // connectors 空 → 不生成 mcp.json
    expect(existsSync(join(pkg, 'mcp.json'))).toBe(false)

    // 产物 manifest.yml 重新 yaml load 后过 manifestSchema
    const manifestText = readFileSync(join(pkg, 'manifest.yml'), 'utf8')
    const manifestDoc = yaml.load(manifestText)
    const r = manifestSchema.safeParse(manifestDoc)
    expect(r.success).toBe(true)

    // files 字段 = 相对路径列表（含 manifest.yml/AGENTS.md/skills/.../hooks.json/orchestration/...）
    expect(Array.isArray(result.files)).toBe(true)
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.files).toContain('manifest.yml')
    expect(result.files).toContain('AGENTS.md')
    expect(result.files).toContain('hooks/hooks.json')
    expect(result.files).toContain('orchestration/dev-engineer.node-table.yml')
    // 所有 files 路径均为相对（不以 / 开头、不含 ..）
    for (const f of result.files) {
      expect(f.startsWith('/')).toBe(false)
      expect(f.includes('..')).toBe(false)
    }

    // 返回 manifest 字段 = 入参 draft.manifest（注入后）
    expect(result.manifest.id).toBe(draft.manifest.id)
  })

  it('⑤ template_id 注入：draft.skills 不带 → 产物 manifest.yml 里有 template_id', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft({ stripTemplateId: true })
    // 入参 draft.manifest.skills 各条无 template_id（schema optional，不传即 undefined）
    for (const s of draft.manifest.skills) {
      if (s.source_type === 'template') {
        expect(s.template_id).toBeUndefined()
      }
    }

    const result = await builder.generate(draft)
    const manifestText = readFileSync(join(result.package_path, 'manifest.yml'), 'utf8')
    const manifestDoc = yaml.load(manifestText) as Manifest
    // 注入后所有 template 来源 skill 都带 template_id=dev-engineer
    for (const s of manifestDoc.skills) {
      if (s.source_type === 'template') {
        expect(s.template_id).toBe('dev-engineer')
      }
    }
  })
})

describe('createEmployeeBuilder.generate — 错误分支', () => {
  it('② local skill 缺 temp → 抛 SkillMissingError', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft()
    // 改一个 skill 为 local，但 tmpRoot/skills/<name>/ 不存在
    draft.manifest.skills = [
      {
        name: 'my-local-skill',
        version: '0.1.0',
        source_type: 'local',
        origin: 'uploaded.zip',
      },
    ]
    draft.skills = [
      {
        name: 'my-local-skill',
        version: '0.1.0',
        source_type: 'local',
        origin: 'uploaded.zip',
        description: '',
      },
    ]
    // tmpRoot/skills/my-local-skill/ 不存在
    await expect(builder.generate(draft)).rejects.toThrow(SkillMissingError)
    await expect(builder.generate(draft)).rejects.toThrow(/my-local-skill/)
  })

  it('③ id 冲突 → 抛 EmployeeIdConflictError', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft()
    // 第一次 generate 成功
    await builder.generate(draft)
    // 第二次同 id → 冲突
    await expect(builder.generate(draft)).rejects.toThrow(EmployeeIdConflictError)
  })

  it('④ 坏 draft（display 空）→ 抛 DraftValidationError 且 issues 携带 path', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft()
    // 改坏 display（schema min(1) 拒空串）
    draft.manifest.display = ''
    await expect(builder.generate(draft)).rejects.toThrow(DraftValidationError)
    try {
      await builder.generate(draft)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DraftValidationError)
      const e = err as DraftValidationError
      expect(e.issues.length).toBeGreaterThan(0)
      // 至少有一条 issue 的 path 含 display
      expect(e.issues.some((i) => i.path.includes('display'))).toBe(true)
    }
  })
})

describe('createEmployeeBuilder.generate — 目录边界', () => {
  it('generate 全程只写注入的 employeesRoot/tmpRoot（base 之外无副作用）', async () => {
    const builder = buildBuilder()
    const draft = buildDevEngineerDraft()
    // base 内 generate 前的目录清单
    const before = readdirSync(base).sort()
    expect(before).toEqual([]) // beforeEach mkdtemp 后空

    await builder.generate(draft)

    // generate 后 base 下只有 employees/ 与 tmp/（customRoot 不存在未创建）
    const after = readdirSync(base).sort()
    expect(after).toEqual(['employees', 'tmp'])
    // employees 下只有 draft.manifest.id 一个目录
    expect(readdirSync(employeesRoot)).toEqual([draft.manifest.id])
    // tmp 下应为空（materialize 成功后 rename 走，无残留）
    expect(readdirSync(tmpRoot)).toEqual([])
  })
})
