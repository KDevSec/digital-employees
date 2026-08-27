import { z } from 'zod'

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
