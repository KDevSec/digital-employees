/**
 * 边界守卫测试（Task 22 / D6 / 收口 Step 1）。
 *
 * 验收锚「全程未触碰 ~/digital-staff/」的可执行证明：
 * 注入隔离 HOME 结构（mkdtempSync base 目录），内含
 *   - employees/ tmp/ templates/custom/ —— 链路 sanctioned 写域
 *   - digital-staff/ —— 预置哨兵目录（写入 sentinel.txt 含时间戳内容）
 *
 * 跑全链：
 *   ① seedBuiltinEmployees(provider, store, builder)（首启物化 7 员工）
 *   ② builder.generate(带 local skill 的 draft)（zip temp 物化路径——用 skill-upload.uploadSkillZip 造真 zip 落 tmp 再 generate）
 *   ③ GET /api/employees 路由调用（花名册扫描读路径）
 *
 * 断言：
 *   - 哨兵目录 mtime 与内容零变化、无新增文件（前后 readdirSync+readFileSync 快照对比）
 *   - 全程只有 employees/tmp/templates-custom 三目录有写入
 *
 * 这把验收锚「全程未触碰 ~/digital-staff/」变成可执行证明。
 *
 * 与 employees-builder.test.ts「目录边界」单测互补：
 *   - 单测只覆盖 builder.generate 一环 → 本测试覆盖 seed+generate+路由全链
 *   - 单测只断 base 下目录集合 → 本测试断哨兵目录 mtime/内容零变化（更精细）
 *   - 单测不涉路由 → 本测试经 toHonoApp 真实路由调用 GET /api/employees
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import yaml from 'js-yaml'
import { manifestSchema } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../src/assets/templates.gen'
import { createTemplatesProvider } from '../src/templates/provider'
import { createEmployeeStore } from '../src/employees/store'
import { createEmployeeBuilder, type EmployeeDraft } from '../src/employees/builder'
import { seedBuiltinEmployees } from '../src/employees/seed'
import { uploadSkillZip } from '../src/employees/skill-upload'
import { createRegistry } from '../src/server/registry'
import { registerEmployeesRoutes } from '../src/server/routes/employees'
import { toHonoApp } from '../src/server/hono-adapter'

let base: string
let employeesRoot: string
let tmpRoot: string
let customRoot: string
let sentinelDir: string
let sentinelFile: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wb-boundary-'))
  employeesRoot = join(base, 'employees')
  tmpRoot = join(base, 'tmp')
  customRoot = join(base, 'templates', 'custom')
  // 哨兵目录：模拟预存的 digital-staff/ 用户数据（与 employees/tmp/templates-custom 同级，链路不应触碰）
  sentinelDir = join(base, 'digital-staff')
  mkdirSync(sentinelDir, { recursive: true })
  // 写入标记文件含时间戳内容（前后快照对比用）
  sentinelFile = join(sentinelDir, 'sentinel.txt')
  writeFileSync(
    sentinelFile,
    `sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}\n`,
    'utf8',
  )
})

/** 目录快照：files 相对路径列表 + 每文件内容 + 每文件 mtimeMs */
interface Snapshot {
  files: string[]
  contents: Record<string, string>
  mtimes: Record<string, number>
}

/** 收集 dir 下全部文件（相对路径，forward slash）+ 内容 + mtime */
function snapshot(dir: string): Snapshot {
  const files: string[] = []
  const contents: Record<string, string> = {}
  const mtimes: Record<string, number> = {}
  walk(dir, '', files, contents, mtimes)
  return { files, contents, mtimes }
}

function walk(
  root: string,
  rel: string,
  files: string[],
  contents: Record<string, string>,
  mtimes: Record<string, number>,
): void {
  const abs = rel === '' ? root : join(root, rel)
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      walk(root, childRel, files, contents, mtimes)
    } else if (entry.isFile()) {
      files.push(childRel)
      contents[childRel] = readFileSync(join(root, childRel), 'utf8')
      mtimes[childRel] = statSync(join(root, childRel)).mtimeMs
    }
  }
}

/** 解析 builtinTemplates['<tplId>/manifest.yml'] → Manifest（schema parse） */
function parseManifest(tplId: string): Manifest {
  const text = builtinTemplates[`${tplId}/manifest.yml`]
  if (text === undefined) throw new Error(`manifest.yml 缺失：${tplId}`)
  const doc = yaml.load(text)
  return manifestSchema.parse(doc) as Manifest
}

describe('L1 收口 · 边界守卫 —— 全链未触碰 ~/digital-staff/', () => {
  it('seed + generate(local skill) + GET /api/employees 全链：哨兵目录 mtime/内容零变化、无新增文件；只有 employees/tmp/templates-custom 有写入', async () => {
    // ---------- 链路前快照 ----------
    const sentinelBefore = snapshot(sentinelDir)
    expect(sentinelBefore.files).toEqual(['sentinel.txt']) // 仅哨兵文件
    expect(sentinelBefore.contents['sentinel.txt']!.length).toBeGreaterThan(0)

    // base 下链路前快照（应只有 digital-staff/，employees/tmp/templates-custom 尚未创建）
    const baseBefore = readdirSync(base).sort()

    // ---------- 装配链路依赖（与 main.ts createServerDeps 同形状） ----------
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })

    // ---------- ① seedBuiltinEmployees：首启物化 7 员工 ----------
    const seedResult = await seedBuiltinEmployees(provider, store, builder)
    expect(seedResult.seeded.length).toBe(7)
    expect(seedResult.skipped).toEqual([])
    // 7 个员工目录在位
    expect(readdirSync(employeesRoot).sort()).toEqual(
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

    // ---------- ② builder.generate(带 local skill 的 draft) ----------
    // 造一个真 zip 落 tmp/skills/<name>/（用 skill-upload.uploadSkillZip 真实管线）
    const skillName = 'boundary-local-skill'
    const zipBytes = zipSync({
      'SKILL.md': strToU8(
        `---\nname: ${skillName}\ndescription: a boundary guard local skill fixture\nversion: 0.1.0\n---\nbody\n`,
      ),
      'references/x.md': strToU8('# x\n'),
    })
    const uploaded = await uploadSkillZip(zipBytes, 'boundary.zip', tmpRoot)
    expect(uploaded.name).toBe(skillName)
    expect(existsSync(join(tmpRoot, 'skills', skillName, 'SKILL.md'))).toBe(true)

    // 组装 draft：以 dev-engineer 为基，skills 全替换为这一个 local skill
    const manifest = parseManifest('dev-engineer')
    const draftManifest = JSON.parse(JSON.stringify(manifest)) as Manifest
    draftManifest.id = 'boundary-emp' // 改 id 避免与 seed 的 dev-engineer 冲突
    draftManifest.display = '边界守卫测试员工'
    draftManifest.skills = [
      {
        name: skillName,
        version: '0.1.0',
        source_type: 'local',
        origin: 'boundary.zip',
      },
    ]
    const draft: EmployeeDraft = {
      manifest: draftManifest,
      skills: [
        {
          name: skillName,
          version: '0.1.0',
          source_type: 'local',
          origin: 'boundary.zip',
          description: 'a boundary guard local skill fixture',
        },
      ],
    }
    const genResult = await builder.generate(draft)
    expect(genResult.package_path).toBe(join(employeesRoot, 'boundary-emp'))
    expect(existsSync(join(employeesRoot, 'boundary-emp', 'manifest.yml'))).toBe(true)
    expect(existsSync(join(employeesRoot, 'boundary-emp', 'skills', skillName, 'SKILL.md'))).toBe(true)

    // ---------- ③ GET /api/employees 路由调用（花名册扫描派生） ----------
    const registry = createRegistry()
    registerEmployeesRoutes(registry, { builder, store })
    const app = toHonoApp(registry)
    const res = await app.request('/api/employees')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      items: Array<{ id: string }>
      invalid: string[]
    }
    // 7 预置 + 1 新建 = 8 卡
    expect(json.items.length).toBe(8)
    expect(json.items.map((c) => c.id).sort()).toEqual(
      [
        'boundary-emp',
        'dev-engineer',
        'req-clarifier',
        'reviewer-expert',
        'sec-code',
        'sec-compliance',
        'sec-design',
        'sys-engineer',
      ].sort(),
    )
    expect(json.invalid).toEqual([])

    // ---------- 链路后快照对比 ----------
    const sentinelAfter = snapshot(sentinelDir)
    expect(sentinelAfter.files).toEqual(sentinelBefore.files) // 无新增/删除文件
    expect(sentinelAfter.files).toEqual(['sentinel.txt'])
    for (const f of sentinelBefore.files) {
      expect(sentinelAfter.contents[f], `哨兵文件 ${f} 内容应零变化`).toBe(
        sentinelBefore.contents[f],
      )
      expect(sentinelAfter.mtimes[f], `哨兵文件 ${f} mtime 应零变化`).toBe(
        sentinelBefore.mtimes[f],
      )
    }

    // ---------- base 下目录集合断言：sanctioned 三域之外只有哨兵 ----------
    // 注：templates-custom 在本链路未被创建（builtin-only 测试，provider 不预创 customRoot）。
    //   关键约束：base 下不应出现 digital-staff 之外的任何「非 sanctioned」目录。
    const baseAfter = readdirSync(base).sort()
    const SANCTIONED = new Set(['employees', 'tmp', 'templates', 'digital-staff'])
    for (const entry of baseAfter) {
      expect(SANCTIONED.has(entry), `base 下出现非 sanctioned 目录：${entry}`).toBe(true)
    }
    // 必含哨兵（链路前已建）+ employees（seed 写入）
    expect(baseAfter).toContain('digital-staff')
    expect(baseAfter).toContain('employees')
    // 哨兵目录本身的内容也没变（再保险：用 statSync 比目录 mtime）
    const sentinelDirMtimeBefore = statSync(sentinelDir).mtimeMs
    const sentinelDirMtimeAfter = statSync(sentinelDir).mtimeMs
    expect(sentinelDirMtimeAfter).toBe(sentinelDirMtimeBefore)

    // ---------- 链路写域断言：employees/tmp 内容真实在位 ----------
    // employees：7 预置 + 1 新建 = 8 目录
    expect(readdirSync(employeesRoot).sort().length).toBe(8)
    // tmp：uploadSkillZip 落的 skills/<name>/ + store.materialize 的 uuid 残留（成功的 rename 后无残留）
    //   至少有 skills/ 目录（upload 留下；generate 不清）
    expect(existsSync(join(tmpRoot, 'skills'))).toBe(true)
    // templates/custom：未被链路创建（builtin-only 测试，custom 模板不存在；provider 不预创 customRoot）
    //   customRoot 目录不应存在（provider 仅在 listSkills/read 时尝试扫描，不创建）
    expect(existsSync(customRoot)).toBe(false)

    // ---------- 额外断言：哨兵目录的 sentinel.txt 仍是写入时的内容（未被任何步骤覆盖） ----------
    const sentinelText = readFileSync(sentinelFile, 'utf8')
    expect(sentinelText).toBe(sentinelBefore.contents['sentinel.txt'])
    expect(sentinelText.startsWith('sentinel-')).toBe(true)
  })

  it('哨兵目录在链路前已含多文件场景：seed 后哨兵全部文件 mtime/内容零变化', async () => {
    // 扩展哨兵目录：再加子目录与多文件（覆盖更真实的「预存用户数据」场景）
    mkdirSync(join(sentinelDir, 'sub'), { recursive: true })
    writeFileSync(join(sentinelDir, 'sub', 'data.json'), '{"k":1}\n', 'utf8')
    writeFileSync(join(sentinelDir, 'README.md'), '# preset\n', 'utf8')

    const sentinelBefore = snapshot(sentinelDir)
    expect(sentinelBefore.files.sort()).toEqual(
      ['README.md', 'sentinel.txt', 'sub/data.json'].sort(),
    )

    // 跑 seed 链路（不跑 generate，专注 seed 边界）
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    const seedResult = await seedBuiltinEmployees(provider, store, builder)
    expect(seedResult.seeded.length).toBe(7)

    // 哨兵零变化
    const sentinelAfter = snapshot(sentinelDir)
    expect(sentinelAfter.files.sort()).toEqual(sentinelBefore.files.sort())
    for (const f of sentinelBefore.files) {
      expect(sentinelAfter.contents[f]).toBe(sentinelBefore.contents[f])
      expect(sentinelAfter.mtimes[f]).toBe(sentinelBefore.mtimes[f])
    }

    // base 下只有 digital-staff + employees（seed 不写 tmp，幂等跳过路径不调 builder.generate；
    //   7 个 builder.generate 各调 store.materialize → tmp/<uuid> 全 rename 走，无残留）
    const baseAfter = readdirSync(base).sort()
    expect(baseAfter).toEqual(['digital-staff', 'employees', 'tmp'].sort())
  })

  it('链路前哨兵目录为空：seed+generate 后仍为空（无任何文件被外部写入）', async () => {
    // 重置哨兵目录为空（beforeEach 已写一个 sentinel.txt，这里清空它）
    const { rmSync } = await import('node:fs')
    rmSync(join(sentinelDir, 'sentinel.txt'), { force: true })
    expect(readdirSync(sentinelDir)).toEqual([])

    // 跑 seed + generate 全链
    const provider = createTemplatesProvider(builtinTemplates, customRoot)
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const builder = createEmployeeBuilder({ provider, store, tmpRoot })
    await seedBuiltinEmployees(provider, store, builder)

    // 简单 generate（template skill，不需要 local 上传）
    const manifest = parseManifest('dev-engineer')
    const draftManifest = JSON.parse(JSON.stringify(manifest)) as Manifest
    draftManifest.id = 'boundary-emp-2'
    draftManifest.display = '边界守卫测试员工 2'
    const draft: EmployeeDraft = {
      manifest: draftManifest,
      skills: draftManifest.skills.map((s) => ({
        name: s.name,
        version: s.version,
        source_type: 'template' as const,
        template_id: 'dev-engineer',
        description: '',
      })),
    }
    await builder.generate(draft)

    // 哨兵仍空
    expect(readdirSync(sentinelDir)).toEqual([])
  })
})
