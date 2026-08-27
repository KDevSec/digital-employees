/**
 * skills 域路由（Task 12 / C1 / E-13）。
 * - POST /api/skills/upload（multipart/form-data → uploadSkillZip → 200 UploadedSkill）
 *   错误形状：
 *     400 BAD_REQUEST —— 无 bodyRaw / 无 File
 *     422 SKILL_ZIP_ERROR —— SkillZipError（zip-slip / 超限 / 坏 zip）
 *     422 SKILL_LAYOUT_ERROR —— SkillLayoutError（无 SKILL.md / 坏 frontmatter）
 * - 域文件按 routes/templates.ts 模式：registerSkillsRoutes(reg, deps) + SkillsRouteDeps 窄接口。
 *
 * 鉴权注记（D-15）：暂无会话机制（G-1），与 healthz / config / templates / employees 同档「无鉴权」；
 * 本机边界 = S-12 仅绑 127.0.0.1 + Host 白名单守卫（adapter 层先于 handler 拦截）。
 */
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { toHonoApp } from '../src/server/hono-adapter'
import { createRegistry } from '../src/server/registry'
import { registerSkillsRoutes } from '../src/server/routes/skills'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wb-routes-skills-'))
})

/** 域装配：只挂 skills 域（域行为聚焦；全量汇总表断言在 routes-registry.test.ts） */
function buildApp() {
  const registry = createRegistry()
  registerSkillsRoutes(registry, { tmpRoot })
  return toHonoApp(registry)
}

/** 造一个合法根布局 zip（用于 multipart POST 的 File 载荷） */
function makeValidZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(
      '---\nname: upload-skill\ndescription: a valid uploaded skill fixture\nversion: 0.2.0\n---\nbody\n',
    ),
    'references/x.md': strToU8('# x\n'),
  })
}

/** multipart POST 便捷入口：构造真 multipart body（FormData → Blob → arrayBuffer） */
async function postUpload(fileBytes: Uint8Array, fileName = 'skill.zip'): Promise<Response> {
  const form = new FormData()
  // 用 Blob 携带二进制（FormData.append 接受 Blob，会自动带 content-type）
  // cast：TS 5 lib.dom 把 Uint8Array 的 buffer 收窄为 ArrayBufferLike（含 SharedArrayBuffer），
  // 但运行时 Blob 接受 Uint8Array；测试场景里 fileBytes 一定是 ArrayBuffer-backed
  const blob = new Blob([fileBytes as unknown as BlobPart], { type: 'application/zip' })
  form.append('file', blob, fileName)
  // Hono app.request 会从 FormData 序列化出 multipart body
  return await buildApp().request('/api/skills/upload', {
    method: 'POST',
    body: form,
  })
}

describe('分域注册（routes/skills.ts 只注册本域端点）', () => {
  it('skills 域路由表 = POST /api/skills/upload', () => {
    const reg = createRegistry()
    registerSkillsRoutes(reg, { tmpRoot })
    expect(reg.routes.map((r) => [r.method, r.path])).toEqual([
      ['POST', '/api/skills/upload'],
    ])
  })
})

describe('POST /api/skills/upload', () => {
  it('200 + UploadedSkill JSON（合法根布局 zip）', async () => {
    const res = await postUpload(makeValidZip(), 'skill.zip')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      name: string
      version: string
      source_type: string
      origin: string
      sha256: string
      files: string[]
    }
    expect(json.name).toBe('upload-skill')
    expect(json.version).toBe('0.2.0')
    expect(json.source_type).toBe('local')
    expect(json.origin).toBe('skill.zip')
    expect(json.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(json.files).toEqual(expect.arrayContaining(['SKILL.md', 'references/x.md']))

    // 落盘验证
    const skillDir = join(tmpRoot, 'skills', 'upload-skill')
    expect(readdirSync(skillDir).length).toBeGreaterThan(0)
  })

  it('400 + BAD_REQUEST（空 body 无 bodyRaw）', async () => {
    // 直接用 app.request 发空 POST（无 content-type 触发 bodyRaw 通道，无 FormData）
    const res = await buildApp().request('/api/skills/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  it('422 + SKILL_LAYOUT_ERROR（非 zip 字节 / 坏 zip）', async () => {
    // 发一段非 zip 字节（multipart 携带一个 .zip 名的随机字节 Blob）
    const notZip = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    const res = await postUpload(notZip, 'not-zip.zip')
    expect(res.status).toBe(422)
    const json = (await res.json()) as { code: string; message: string }
    // 非 zip 字节 → unzipSync 抛 → SkillZipError → 422
    expect(['SKILL_ZIP_ERROR', 'SKILL_LAYOUT_ERROR']).toContain(json.code)
  })

  it('422 + SKILL_ZIP_ERROR（zip-slip entry）', async () => {
    const zipBytes = zipSync({
      'SKILL.md': strToU8(
        '---\nname: slip-skill\ndescription: a zip slip attempt fixture\n---\nbody\n',
      ),
      '../evil.txt': strToU8('pwned\n'),
    })
    const res = await postUpload(zipBytes, 'slip.zip')
    expect(res.status).toBe(422)
    const json = (await res.json()) as { code: string; message: string }
    expect(json.code).toBe('SKILL_ZIP_ERROR')
  })

  it('422 + SKILL_LAYOUT_ERROR（无 SKILL.md）', async () => {
    const zipBytes = zipSync({
      'README.md': strToU8('# readme\n'),
    })
    const res = await postUpload(zipBytes, 'no-skill.zip')
    expect(res.status).toBe(422)
    const json = (await res.json()) as { code: string; message: string }
    expect(json.code).toBe('SKILL_LAYOUT_ERROR')
  })
})

describe('Host 白名单守卫照常（skills 域）', () => {
  it('POST /api/skills/upload 带 Host: evil.com → 403', async () => {
    const form = new FormData()
    const blob = new Blob([makeValidZip() as unknown as BlobPart], { type: 'application/zip' })
    form.append('file', blob, 'skill.zip')
    const res = await buildApp().request('/api/skills/upload', {
      method: 'POST',
      headers: { Host: 'evil.com' },
      body: form,
    })
    expect(res.status).toBe(403)
  })
})
