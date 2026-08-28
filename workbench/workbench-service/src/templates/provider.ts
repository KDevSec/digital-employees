/**
 * templates provider（Task 7 / B2）：builtin 内存资产 + custom fs 聚合。
 *
 * 数据源：
 * - builtin：从 `builtinTemplates` 内存 Record 取键值（键序按字典升序保证稳定）；
 *   键形如 `<tplId>/manifest.yml`、`<tplId>/skills/<name>/SKILL.md`，由 codegen（Task 6 / B1）生成。
 * - custom：扫 `customRoot` 下的目录，每目录读 `manifest.yml` + `skills/<name>/SKILL.md`（fs）；
 *   customRoot 不存在 / 空 → 空数组不炸。
 *
 * 解析：
 * - manifest.yml：js-yaml load → manifestSchema.parse（shared-protocol v0.2）；解析失败跳过该模板，
 *   原因收集到 `errors: string[]`（tplId + 简要原因）。list() 不抛错——返回不炸、坏模板缺席。
 * - SKILL.md frontmatter：`---` 分割取首段 yaml → js-yaml load → 取 description；解析失败 description=''。
 *
 * 聚合语义：
 * - list()：builtin 先（键序=字母序）、custom 后；按 TemplateMeta 形状返回。
 * - listSkills()：跨模板聚合，按 skill.name 首见去重——builtin 先、custom 后；
 *   同名 skill 在 builtin 与 custom 都有时，builtin 胜出（version/templateId/description 取 builtin 的）。
 *
 * 设计：与 routes/templates.ts 解耦——provider 是纯数据面，路由层只组装 JSON 响应。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { manifestSchema, skillFrontmatterSchema } from '@devzero/shared-protocol'
import type { Manifest } from '@devzero/shared-protocol'
import type { SkillEntry } from '@devzero/shared-protocol'

export interface TemplateMeta {
  /** 目录名（模板 id） */
  id: string
  display: string
  brief: string
  avatar: string
  kind: 'flow-owner' | 'callee'
  /** requires.level */
  level: string
  /** manifest.skills.length */
  skillsCount: number
  builtin: boolean
}

export interface SkillMeta {
  name: string
  /** manifest.skills[] 条目 version */
  version: string
  /** 该 skill 的 SKILL.md frontmatter description；解析失败给 '' */
  description: string
  /** 所属模板 id */
  templateId: string
  builtin: boolean
}

export interface TemplatesProvider {
  /** builtin 先（manifest 键序即字母序）、custom 后；解析失败的模板缺席 */
  list(): TemplateMeta[]
  /** 相对路径读（'<tplId>/manifest.yml' 等）；builtin 走内存、custom 走 fs；不存在返回 null */
  read(relPath: string): string | null
  /** builtin 全集跨模板聚合 + custom 模板的 skills；按 name 去重首见 */
  listSkills(): SkillMeta[]
  /** custom 模板根目录（main 装配时为 profileDir/templates/custom） */
  readonly customRoot: string
  /** 解析失败的模板收集（tplId + 原因）；测试可注入断言 */
  readonly errors: string[]
}

export function createTemplatesProvider(
  builtin: Record<string, string>,
  customRoot: string,
): TemplatesProvider {
  const errors: string[] = []
  // builtin 模板列表：键序升序保证稳定；只取以 /manifest.yml 结尾的顶层键
  const builtinTemplateIds: string[] = Object.keys(builtin)
    .filter((k) => k.endsWith('/manifest.yml'))
    .map((k) => k.slice(0, -'/manifest.yml'.length))
    .sort()

  // builtin manifest 解析缓存（id -> Manifest）；解析失败不入表
  const builtinManifests = new Map<string, Manifest>()
  for (const id of builtinTemplateIds) {
    const text = builtin[`${id}/manifest.yml`]
    if (text === undefined) continue
    const parsed = parseManifest(text)
    if (parsed.ok) {
      builtinManifests.set(id, parsed.manifest)
    } else {
      errors.push(`builtin:${id} — ${parsed.reason}`)
    }
  }

  // custom 模板：扫 customRoot 下目录（不递归），每目录读 manifest.yml
  // customRoot 不存在或非目录 → 空列表（不炸）
  const customTemplateIds: string[] = []
  const customManifests = new Map<string, Manifest>()
  if (existsSync(customRoot) && statSync(customRoot).isDirectory()) {
    let entries: string[] = []
    try {
      entries = readdirSync(customRoot)
    } catch {
      // 权限/IO 错误 → 视作空 customRoot（不炸；坏 fs 状态属运行环境问题，不阻断路由）
      entries = []
    }
    for (const entry of entries) {
      const dir = join(customRoot, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const mPath = join(dir, 'manifest.yml')
      if (!existsSync(mPath)) continue
      const text = readFileSync(mPath, 'utf8')
      const parsed = parseManifest(text)
      if (parsed.ok) {
        customManifests.set(entry, parsed.manifest)
        customTemplateIds.push(entry)
      } else {
        errors.push(`custom:${entry} — ${parsed.reason}`)
      }
    }
  }

  return {
    customRoot,
    get errors() {
      return [...errors]
    },

    list(): TemplateMeta[] {
      const out: TemplateMeta[] = []
      for (const id of builtinTemplateIds) {
        const m = builtinManifests.get(id)
        if (!m) continue // 解析失败的模板缺席
        out.push(manifestToMeta(id, m, true))
      }
      for (const id of customTemplateIds) {
        const m = customManifests.get(id)
        if (!m) continue
        out.push(manifestToMeta(id, m, false))
      }
      return out
    },

    read(relPath: string): string | null {
      // builtin 内存命中优先（同一相对键 builtin 与 custom 都可能存在时，builtin 胜出——与 listSkills 同语义）
      if (Object.prototype.hasOwnProperty.call(builtin, relPath)) {
        return builtin[relPath] ?? null
      }
      // 否则走 fs：customRoot/<relPath>（防止越界 customRoot：path 不含 .. —— 简单判据）
      if (relPath.includes('..')) return null
      const abs = join(customRoot, relPath)
      if (!existsSync(abs)) return null
      try {
        return readFileSync(abs, 'utf8')
      } catch {
        return null
      }
    },

    listSkills(): SkillMeta[] {
      const out: SkillMeta[] = []
      const seen = new Set<string>()
      // builtin 先（按 builtinTemplateIds 序即字母序），custom 后
      for (const id of builtinTemplateIds) {
        const m = builtinManifests.get(id)
        if (!m) continue
        for (const skill of m.skills) {
          if (seen.has(skill.name)) continue
          seen.add(skill.name)
          out.push(skillToMeta(skill, id, true, builtin))
        }
      }
      for (const id of customTemplateIds) {
        const m = customManifests.get(id)
        if (!m) continue
        for (const skill of m.skills) {
          if (seen.has(skill.name)) continue
          seen.add(skill.name)
          out.push(skillToMeta(skill, id, false, builtin, customRoot))
        }
      }
      return out
    },
  }
}

// ---------- 内部辅助 ----------

function parseManifest(text: string): { ok: true; manifest: Manifest } | { ok: false; reason: string } {
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch (err) {
    return { ok: false, reason: `YAML 解析失败：${(err as Error).message}` }
  }
  const r = manifestSchema.safeParse(doc)
  if (r.success) {
    return { ok: true, manifest: r.data }
  }
  // 取首条 issue 的 path+message 作简要原因（足够定位，不展开全部 issue）
  const first = r.error.issues[0]
  const path = first ? first.path.join('.') : '<root>'
  const msg = first ? first.message : '未知校验错误'
  return { ok: false, reason: `manifest 校验失败 @ ${path}：${msg}` }
}

function manifestToMeta(id: string, m: Manifest, builtin: boolean): TemplateMeta {
  return {
    id,
    display: m.display,
    brief: m.brief,
    avatar: m.avatar,
    kind: m.kind,
    level: m.requires.level,
    skillsCount: m.skills.length,
    builtin,
  }
}

function skillToMeta(
  skill: SkillEntry,
  templateId: string,
  builtin: boolean,
  builtinMap: Record<string, string>,
  customRoot?: string,
): SkillMeta {
  const description = readSkillDescription(skill.name, templateId, builtin, builtinMap, customRoot)
  return {
    name: skill.name,
    version: skill.version,
    description,
    templateId,
    builtin,
  }
}

/**
 * 读 SKILL.md frontmatter description：
 * - builtin：从 builtinMap['<tplId>/skills/<name>/SKILL.md'] 取文本
 * - custom：从 fs 读 customRoot/<tplId>/skills/<name>/SKILL.md
 * frontmatter 解析失败 / 缺 description → 返回 ''
 */
function readSkillDescription(
  skillName: string,
  templateId: string,
  builtin: boolean,
  builtinMap: Record<string, string>,
  customRoot?: string,
): string {
  const relPath = `${templateId}/skills/${skillName}/SKILL.md`
  let text: string | null = null
  if (builtin) {
    text = builtinMap[relPath] ?? null
  } else if (customRoot) {
    const abs = join(customRoot, relPath)
    if (existsSync(abs)) {
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        text = null
      }
    }
  }
  if (text === null) return ''
  return parseSkillDescription(text)
}

/** SKILL.md frontmatter：`---` 分割取首段 yaml → js-yaml load → skillFrontmatterSchema.safeParse → 取 description */
function parseSkillDescription(text: string): string {
  // frontmatter 形如：---\n<yaml>\n---\n...  取首对 --- 之间内容
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return ''
  const fmText = m[1]
  if (!fmText) return ''
  let doc: unknown
  try {
    doc = yaml.load(fmText)
  } catch {
    return ''
  }
  if (typeof doc !== 'object' || doc === null) return ''
  const r = skillFrontmatterSchema.safeParse(doc)
  if (!r.success) {
    // frontmatter 不合规（如缺 description 或 description < 10 字）—— 退回 raw 取 description（兼容简版 fixture）
    const desc = (doc as Record<string, unknown>).description
    return typeof desc === 'string' ? desc : ''
  }
  return r.data.description
}
