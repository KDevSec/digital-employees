/**
 * templates 域 API 客户端（L1 员工新建线 Task 13，对齐 service B2 端点）：
 * - GET /api/templates → { items: TemplateMeta[] }（builtin 先、custom 后）
 * - GET /api/skills → { items: SkillMeta[] }（跨模板聚合 + 按 name 首见去重）
 *
 * 类型形状与 service templates/provider.ts 同字段名（DTO 对齐即可，不直接 import service 内部类型，
 * 避免 web ↔ service 跨包类型耦合）。fetch 沿 api/health.ts / api/access.ts 手法：
 * 同源相对路径 + 2s 超时 + 失败归一 null（调用方按空数组处理）。
 */

/** 模板元信息（与 service TemplateMeta 字段同形） */
export interface TemplateMeta {
  id: string
  display: string
  brief: string
  avatar: string
  kind: 'flow-owner' | 'callee'
  level: string
  skillsCount: number
  builtin: boolean
}

/** skill 元信息（与 service SkillMeta 字段同形） */
export interface SkillMeta {
  name: string
  version: string
  description: string
  templateId: string
  builtin: boolean
}

/** fetch 失败统一归一 null（调用方按需兜底空数组） */
async function getJson<T>(path: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(path, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 拉取模板清单（GET /api/templates）；失败归一空数组 */
export async function fetchTemplates(): Promise<TemplateMeta[]> {
  const data = await getJson<{ items: TemplateMeta[] }>('/api/templates')
  if (!data || !Array.isArray(data.items)) return []
  return data.items
}

/** 拉取 skill 全集（GET /api/skills）；失败归一空数组 */
export async function fetchSkills(): Promise<SkillMeta[]> {
  const data = await getJson<{ items: SkillMeta[] }>('/api/skills')
  if (!data || !Array.isArray(data.items)) return []
  return data.items
}

/**
 * 上传 skill zip 包（POST /api/skills/upload，FormData）。
 * service 侧端点待随上传管线落地（Task 14 web 侧 UI 在位先接通调用）；
 * 成功返回新增 skill 元信息（含 source_type='local' 标记），失败抛错由调用方 toast。
 */
export interface UploadedSkill {
  name: string
  version: string
  description: string
}

export async function uploadSkillZip(file: File): Promise<UploadedSkill> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/skills/upload', { method: 'POST', body: form })
  const data = (await res.json().catch(() => ({}))) as { name?: string; version?: string; description?: string; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data.error?.message ?? res.statusText)
  }
  return {
    name: data.name ?? file.name.replace(/\.zip$/i, ''),
    version: data.version ?? '0.1.0',
    description: data.description ?? '',
  }
}
