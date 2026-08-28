import { z } from 'zod'
import yaml from 'js-yaml'

// skillFrontmatterSchema：SKILL.md frontmatter（strict）
// ─ name：slug（小写字母/数字/连字符，首字符须为字母或数字）
// ─ description：≥10 字（中英文按字符数计）
// ─ vendored_from?/license?/version?：P2 决策的扩展键（version 缺省由消费方补 '0.1.0'）
// strict：未知键拒
const slugRe = /^[a-z0-9][a-z0-9-]*$/

export const skillFrontmatterSchema = z.object({
  name: z.string().regex(slugRe),
  description: z.string().min(10),
  vendored_from: z.string().optional(),
  license: z.string().optional(),
  version: z.string().optional(),
}).strict()

// skillEntrySchema：manifest.skills[] 条目（discriminatedUnion on source_type）
// ─ template 分支：{ name, version, source_type: 'template', template_id?: string }
// ─ local 分支：{ name, version, source_type: 'local', origin?: string }
// ─ agenthub 等其他值由 discriminatedUnion 拒（V0.2 预留——local 之外的 source_type 应被拒）
export const skillEntrySchema = z.discriminatedUnion('source_type', [
  z.object({
    name: z.string(),
    version: z.string(),
    source_type: z.literal('template'),
    template_id: z.string().optional(),
  }),
  z.object({
    name: z.string(),
    version: z.string(),
    source_type: z.literal('local'),
    origin: z.string().optional(),
  }),
])

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>
export type SkillEntry = z.infer<typeof skillEntrySchema>

// parseSkillFrontmatter：SKILL.md 文本 → frontmatter（Task 12 / E-13 抽离自 service skill-upload.ts）
// ─ 入参是 SKILL.md 全文（含 --- 边界），调用方负责读文件
// ─ 解析：`---` 分割取首段 yaml → js-yaml load → skillFrontmatterSchema.safeParse
// ─ 失败：返回 { ok: false, reason }——reason 含具体阶段（边界缺失 / yaml 解析失败 / schema 校验失败）
// ─ 成功：返回 { ok: true, value: SkillFrontmatter }
//
// 复用：service skill-upload.ts（zip 上传校验）消费此函数；templates provider.ts 也有本地一份
// frontmatter 解析（Task 7 取 description 用），本任务不动它——留给终审统一收口。
export type ParsedSkillFrontmatter =
  | { ok: true; value: SkillFrontmatter }
  | { ok: false; reason: string }

export function parseSkillFrontmatter(mdText: string): ParsedSkillFrontmatter {
  // frontmatter 形如：---\n<yaml>\n---\n...  取首对 --- 之间内容
  const m = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) {
    return { ok: false, reason: 'frontmatter 边界缺失（未找到首对 ---）' }
  }
  const fmText = m[1]
  if (!fmText) {
    return { ok: false, reason: 'frontmatter 为空' }
  }
  let doc: unknown
  try {
    doc = yaml.load(fmText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `yaml 解析失败：${msg}` }
  }
  if (typeof doc !== 'object' || doc === null) {
    return { ok: false, reason: 'frontmatter 顶层非对象' }
  }
  const r = skillFrontmatterSchema.safeParse(doc)
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    return { ok: false, reason: issues }
  }
  return { ok: true, value: r.data }
}

