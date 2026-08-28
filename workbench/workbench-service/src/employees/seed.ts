/**
 * 预置物化（Task 18 / D2）：首启 7 个 builtin 模板走同一 E-12 管线进员工库。
 *
 * 语义：
 * - 遍历 provider.list() 的 builtin 模板（builtin===true；custom 不 seed）
 * - 每模板：store.exists(id) → skipped；否则组装 draft → builder.generate → seeded
 * - 幂等：已存在跳过不比较内容（快照语义，spec §9）
 *
 * draft 组装（与向导产物同源）：
 * - manifest = yaml.load(provider.read('<tplId>/manifest.yml')) 过 manifestSchema.parse
 *   （operator 替换为 opts.operator ?? 'demo@devzero.local'；其余字段原样）
 * - skills = manifest.skills 每条附 description（从 provider.read('<tplId>/skills/<name>/SKILL.md')
 *   经 parseSkillFrontmatter 取 description，解析失败给 ''）
 *   + template_id（template 分支注入该模板 id）
 *
 * main.ts 装配：try { await seedBuiltinEmployees(...) } catch { logger warn }
 * —— seed 失败不阻断服务启动；单模板 generate 抛错直接向上抛（main.ts catch 兜底）。
 */
import yaml from 'js-yaml'
import { manifestSchema, parseSkillFrontmatter } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import type { TemplatesProvider } from '../templates/provider'
import type { createEmployeeStore } from './store'
import type { createEmployeeBuilder, EmployeeDraft } from './builder'

/** 默认 operator 占位（与 7 模板 manifest 中 operator 同值，首启语义） */
const DEFAULT_OPERATOR = 'demo@devzero.local'

export interface SeedResult {
  /** 本次新物化的员工 id 列表 */
  seeded: string[]
  /** 已存在被跳过的员工 id 列表（幂等语义） */
  skipped: string[]
}

/**
 * 首启物化 builtin 模板为员工。
 *
 * 遍历 provider.list() 的 builtin 模板：已存在跳过（skipped）；否则组装 draft → builder.generate（seeded）。
 * 单模板 generate 抛错直接向上抛（调用方 catch 兜底，不阻断整体服务启动）。
 *
 * @param provider 模板 provider（读 builtin 模板 manifest 与 SKILL.md）
 * @param store 员工库 store（exists 预检 + materialize 由 builder 内部调）
 * @param builder 员工构建器（管线八步）
 * @param opts.operator 占位 operator（默认 'demo@devzero.local'）
 */
export async function seedBuiltinEmployees(
  provider: TemplatesProvider,
  store: ReturnType<typeof createEmployeeStore>,
  builder: ReturnType<typeof createEmployeeBuilder>,
  opts?: { operator?: string },
): Promise<SeedResult> {
  const operator = opts?.operator ?? DEFAULT_OPERATOR
  const seeded: string[] = []
  const skipped: string[] = []

  for (const meta of provider.list()) {
    if (!meta.builtin) continue // custom 模板不 seed

    const tplId = meta.id

    // 幂等：已存在跳过不比较内容（快照语义）
    if (store.exists(tplId)) {
      skipped.push(tplId)
      continue
    }

    // 组装 draft（与向导产物同源）+ builder.generate
    const draft = buildDraftFromTemplate(tplId, provider, operator)
    await builder.generate(draft)
    seeded.push(tplId)
  }

  return { seeded, skipped }
}

/**
 * 从模板组装 EmployeeDraft（导出供测试同构断言用）。
 *
 * 逻辑与向导「选模板 → 预填 draft」同源：
 * - manifest 从 provider.read('<tplId>/manifest.yml') 读，过 manifestSchema.parse
 * - operator 替换为占位邮箱
 * - skills 每条附 description（从 SKILL.md frontmatter 取，失败给 ''）
 *   + template_id（template 分支注入该模板 id）
 */
export function buildDraftFromTemplate(
  tplId: string,
  provider: TemplatesProvider,
  operator: string = DEFAULT_OPERATOR,
): EmployeeDraft {
  const manifestText = provider.read(`${tplId}/manifest.yml`)
  if (manifestText === null) {
    throw new Error(`模板 ${tplId} manifest.yml 不存在`)
  }

  const doc = yaml.load(manifestText)
  const manifest = manifestSchema.parse(doc) as Manifest

  // operator 替换为占位（其余字段原样）
  manifest.operator = operator

  // skills 附 description + template_id
  const skills: EmployeeDraft['skills'] = manifest.skills.map((s) => {
    let description = ''
    const skillMdText = provider.read(`${tplId}/skills/${s.name}/SKILL.md`)
    if (skillMdText !== null) {
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
      origin?: string
      description: string
    } = {
      name: s.name,
      version: s.version,
      source_type: s.source_type,
      description,
    }
    if (s.source_type === 'template') {
      draftSkill.template_id = tplId
    } else if (s.origin) {
      draftSkill.origin = s.origin
    }
    return draftSkill
  })

  return { manifest, skills }
}
