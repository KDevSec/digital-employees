/**
 * skills 域路由（Task 12 / C1 / E-13）。
 * - POST /api/skills/upload（multipart/form-data → uploadSkillZip → 200 UploadedSkill）
 *   错误形状：
 *     400 BAD_REQUEST —— 无 bodyRaw / 无 File
 *     422 SKILL_ZIP_ERROR —— SkillZipError（zip-slip / 超限 / 坏 zip）
 *     422 SKILL_LAYOUT_ERROR —— SkillLayoutError（无 SKILL.md / 坏 frontmatter）
 *
 * multipart 解析策略：adapter 把 content-type 含 multipart/form-data 的 bodyRaw 交给本域，
 * 本域用 Web 标准 API `new Request(...).formData()` 取第一个 File——不手解析 multipart 边界，
 * 也不让 hono 在 adapter 层提前消费 body（保留 bodyRaw 通道的通用性）。
 *
 * 域文件按 routes/templates.ts 模式：registerSkillsRoutes(reg, deps) + SkillsRouteDeps 窄接口。
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz / config / templates / employees 同档「无鉴权」；
 * 本机边界 = S-12 仅绑 127.0.0.1 + Host 白名单守卫（adapter 层先于 handler 拦截）。
 */
import type { Ctx, Res, RouteRegistry } from '../registry'
import { SkillLayoutError, SkillZipError, uploadSkillZip } from '../../employees/skill-upload'

/** skills 域依赖：tmpRoot（与 builder 同源；落 tmpRoot/skills/<name>/） */
export interface SkillsRouteDeps {
  tmpRoot: string
}

/** 错误码（沿 SKILL_ZIP_ERROR / SKILL_LAYOUT_ERROR 命名风格） */
const BAD_REQUEST = 'BAD_REQUEST'
const SKILL_ZIP_ERROR = 'SKILL_ZIP_ERROR'
const SKILL_LAYOUT_ERROR = 'SKILL_LAYOUT_ERROR'

/** POST /api/skills/upload —— multipart zip 上传 → uploadSkillZip → 200 UploadedSkill */
export function skillsUploadHandler(deps: SkillsRouteDeps) {
  return async (ctx: Ctx): Promise<Res> => {
    if (!ctx.bodyRaw || ctx.bodyRaw.byteLength === 0) {
      return { status: 400, json: { code: BAD_REQUEST, message: '请求体为空（multipart/form-data 期望 File）' } }
    }
    const ct = ctx.headers?.['content-type']
    if (!ct || !ct.toLowerCase().includes('multipart/form-data')) {
      // 非 multipart（如 application/octet-stream 直传）—— 也按 BAD_REQUEST 拒（当前契约只支持 multipart）
      return { status: 400, json: { code: BAD_REQUEST, message: 'content-type 非 multipart/form-data' } }
    }

    // 用 Web 标准 API 重构 FormData：把 bodyRaw + content-type 包成 Request 取 formData()
    let form: FormData
    try {
      const req = new Request('http://localhost', {
        method: 'POST',
        body: ctx.bodyRaw,
        headers: { 'content-type': ct },
      })
      form = await req.formData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 400, json: { code: BAD_REQUEST, message: `multipart 解析失败：${msg}` } }
    }

    const file = form.values().next().value
    if (!(file instanceof File) || file.size === 0) {
      return { status: 400, json: { code: BAD_REQUEST, message: 'FormData 中无有效 File' } }
    }

    const zipBytes = new Uint8Array(await file.arrayBuffer())
    try {
      const result = await uploadSkillZip(zipBytes, file.name, deps.tmpRoot)
      return { status: 200, json: result }
    } catch (err) {
      if (err instanceof SkillZipError) {
        return { status: 422, json: { code: SKILL_ZIP_ERROR, message: err.message } }
      }
      if (err instanceof SkillLayoutError) {
        return { status: 422, json: { code: SKILL_LAYOUT_ERROR, message: err.message } }
      }
      // 未分类错误 —— 不暴露内部细节，500 兜底
      const msg = err instanceof Error ? err.message : String(err)
      return { status: 500, json: { code: 'INTERNAL_ERROR', message: msg } }
    }
  }
}

/** skills 域注册（只注册本域端点；汇总见 routes/index.ts） */
export function registerSkillsRoutes(reg: RouteRegistry, deps: SkillsRouteDeps): void {
  reg.post('/api/skills/upload', skillsUploadHandler(deps))
}
