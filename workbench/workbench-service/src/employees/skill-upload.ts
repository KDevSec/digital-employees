/**
 * skill zip 上传管线（Task 12 / C1 / E-13）。
 *
 * uploadSkillZip(zipBytes, fileName, tmpRoot): 解包 → 五种防护 → 物化 → UploadedSkill。
 *
 * 五种防护（按管线顺序）：
 *   1. zip-slip：entry 名含 `..` 段或以 `/` 开头 → SkillZipError
 *   2. GBK 文件名：fflate 出的 entry 名若含 U+FFFD 或高位字符（未标 UTF-8 flag 的 CP437 名），
 *      用 TextDecoder('gbk') 对 Uint8Array.from(name, c => c.charCodeAt(0) & 0xff) 重解码；
 *      解码失败（仍含 U+FFFD）保留原名并在 files 列表如实反映
 *   3. 限额：解压后总字节 >50MB 或文件数 >2000 → SkillZipError
 *   4. 布局：根有 SKILL.md → 直接用；否则唯一顶层目录且其下有 SKILL.md → 剥一层；都不满足 → SkillLayoutError
 *   5. frontmatter：SKILL.md 文本按 `---` 分割取 yaml → skillFrontmatterSchema.safeParse；
 *      不过 → SkillLayoutError（带 zod issue 信息）
 *
 * 物化：tmpRoot/skills/<frontmatter.name>/（目录名以 frontmatter name 为准——zip 目录名与 name
 * 不一致时重命名；清空旧内容再写 = 二次上传幂等）；写全部文件（相对 SKILL.md 的路径）。
 * sha256 = 原始 zipBytes 的 hash（不是解压后内容的 hash）。
 *
 * 目录边界：本模块写域止于注入的 tmpRoot/skills/<name>/，绝不触碰其他目录。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { strFromU8, unzipSync } from 'fflate'
import { skillFrontmatterSchema } from '@devzero/shared-protocol'

/** zip 布局错误（无 SKILL.md / 坏 frontmatter / 多顶层目录） */
export class SkillLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillLayoutError'
  }
}

/** zip 解包错误（zip-slip / 超限 / 坏 zip） */
export class SkillZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillZipError'
  }
}

export interface UploadedSkill {
  name: string
  version: string
  source_type: 'local'
  origin: string
  sha256: string
  files: string[]
}

/** 限额（设计 §x：单 skill 包解压后上限） */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_FILE_COUNT = 2000

/**
 * 把 zip 字节解包到 tmpRoot/skills/<name>/，返回 UploadedSkill。
 *
 * @param zipBytes 原始 zip 字节（multipart 上传的 File.arrayBuffer）
 * @param fileName 上传文件名（用于 origin 字段）
 * @param tmpRoot 物化根目录（与 builder/tmpRoot 同源；落 tmpRoot/skills/<name>/）
 */
export async function uploadSkillZip(
  zipBytes: Uint8Array,
  fileName: string,
  tmpRoot: string,
): Promise<UploadedSkill> {
  // 1. 解包 + zip-slip 防护 + GBK 解码
  const entries = unzipSafe(zipBytes)

  // 2. 限额
  let totalBytes = 0
  for (const e of entries) totalBytes += e.data.length
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new SkillZipError(`解压后总字节超限（${totalBytes} > ${MAX_TOTAL_BYTES}）`)
  }
  if (entries.length > MAX_FILE_COUNT) {
    throw new SkillZipError(`解压后文件数超限（${entries.length} > ${MAX_FILE_COUNT}）`)
  }

  // 3. 布局判定：根 SKILL.md / 唯一顶层目录剥层
  const { files, skillMdEntry } = resolveLayout(entries)

  // 4. frontmatter 校验
  const skillMdText = strFromU8(skillMdEntry.data)
  const fm = parseSkillFrontmatter(skillMdText)
  if (!fm.ok) {
    throw new SkillLayoutError(`SKILL.md frontmatter 校验失败：${fm.error}`)
  }
  const skillName = fm.value.name
  const skillVersion = fm.value.version ?? '0.1.0'

  // 5. 物化 tmpRoot/skills/<skillName>/（清空旧内容 = 二次上传幂等）
  const skillDir = join(tmpRoot, 'skills', skillName)
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true })
  }
  mkdirSync(skillDir, { recursive: true })
  for (const f of files) {
    const filePath = join(skillDir, f.path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, f.data)
  }

  // 6. sha256 = 原始 zipBytes 的 hash
  const sha256 = createHash('sha256').update(zipBytes).digest('hex')

  return {
    name: skillName,
    version: skillVersion,
    source_type: 'local',
    origin: fileName,
    sha256,
    files: files.map((f) => f.path),
  }
}

// ---------- 解包 + zip-slip + GBK ----------

interface ZipEntry {
  /** 经 GBK 重解码后的 entry 名（解包路径，相对 zip 根） */
  name: string
  /** 解码前的原始 entry 名（用于诊断） */
  rawName: string
  data: Uint8Array
}

/** unzipSync 包装：zip-slip 防护 + GBK 文件名重解码 */
function unzipSafe(zipBytes: Uint8Array): ZipEntry[] {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(zipBytes)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new SkillZipError(`zip 解包失败：${msg}`)
  }

  const entries: ZipEntry[] = []
  for (const [rawName, data] of Object.entries(unzipped)) {
    // 跳过目录条目（fflate 出的目录条目通常以 / 结尾且 data 为空 Uint8Array）
    if (rawName.endsWith('/') && data.length === 0) continue

    // zip-slip：normalize 后不得含 `..` 段且不得以 / 开头（POSIX 与 Windows 都防）
    if (isZipSlip(rawName)) {
      throw new SkillZipError(`zip-slip 入侵：entry 名含 ".." 段或以 "/" 开头：${rawName}`)
    }

    // GBK 重解码：fflate 出的 CP437 名含高位字符（U+0080-U+00FF）或 U+FFFD 替换符 → 试 GBK
    const name = maybeDecodeGbk(rawName)
    entries.push({ name, rawName, data })
  }
  return entries
}

/** zip-slip 判定：路径含 `..` 段、以 / \ 开头、或带 Windows 盘符前缀（防越出物化目录） */
function isZipSlip(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\')) return true
  // Windows 盘符前缀（C:\ 或 C:/）—— join 会当绝对路径解析，越出物化目录
  if (/^[a-zA-Z]:[/\\]/.test(name)) return true
  const segments = name.split(/[/\\]/)
  return segments.some((s) => s === '..')
}

/**
 * GBK 重解码：fflate 出的 entry 名若含高位字符（U+0080-U+00FF，未标 UTF-8 flag 的 CP437 名）
 * 或 U+FFFD 替换符（声称 UTF-8 但解码失败），用 TextDecoder('gbk') 对原始字节重解码。
 *
 * 重解码后若仍含 U+FFFD（GBK 也无法识别）→ 保留原名并在 files 列表如实反映（不抛错）。
 * 仅含 ASCII 的名直接返回（不影响 ASCII 路径）。
 */
function maybeDecodeGbk(name: string): string {
  let hasHighBit = false
  let hasReplacement = false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (c >= 0x80 && c <= 0xff) hasHighBit = true
    if (c === 0xfffd) hasReplacement = true
  }
  if (!hasHighBit && !hasReplacement) return name

  try {
    const buf = Uint8Array.from(name, (c) => c.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('gbk').decode(buf)
    if (!decoded.includes('�')) return decoded
  } catch {
    // TextDecoder('gbk') 不支持（Bun ICU 缺该编码）—— 保留原名
  }
  return name
}

// ---------- 布局判定 ----------

interface LayoutFile {
  path: string
  data: Uint8Array
}

/** 解析布局：根 SKILL.md 直接用 / 唯一顶层目录剥层 / 否则 SkillLayoutError */
function resolveLayout(entries: ZipEntry[]): { files: LayoutFile[]; skillMdEntry: ZipEntry } {
  // 优先根布局：包内有 SKILL.md（在根）
  const rootSkillMd = entries.find((e) => e.name === 'SKILL.md')
  if (rootSkillMd) {
    return { files: entries.map(toLayoutFile), skillMdEntry: rootSkillMd }
  }

  // 否则检查唯一顶层目录：所有 entry 共享同一顶层目录名，且该目录下有 SKILL.md
  const topDirs = new Set<string>()
  for (const e of entries) {
    const idx = e.name.indexOf('/')
    if (idx <= 0) {
      // 没有 / 意味着文件直接在根但没有 SKILL.md（已被上面分支排除）→ 不是单顶层目录布局
      throw new SkillLayoutError('zip 内无根 SKILL.md，且存在根级裸文件，无法判定剥层目录')
    }
    topDirs.add(e.name.slice(0, idx))
  }
  if (topDirs.size !== 1) {
    throw new SkillLayoutError(`zip 内无根 SKILL.md，且有 ${topDirs.size} 个顶层目录（期望唯一）`)
  }
  const [topDir] = topDirs
  if (!topDir) {
    throw new SkillLayoutError('zip 内无根 SKILL.md 且顶层目录名为空')
  }
  // 剥层：去掉顶层目录前缀
  const stripped = entries.map((e) => ({
    ...e,
    name: e.name.slice(topDir.length + 1),
  }))
  const skillMdEntry = stripped.find((e) => e.name === 'SKILL.md')
  if (!skillMdEntry) {
    throw new SkillLayoutError(`zip 顶层目录 ${topDir}/ 下无 SKILL.md`)
  }
  return { files: stripped.map(toLayoutFile), skillMdEntry }
}

function toLayoutFile(e: ZipEntry): LayoutFile {
  return { path: e.name, data: e.data }
}

// ---------- frontmatter 校验 ----------

interface FrontmatterOk {
  ok: true
  value: {
    name: string
    description: string
    version?: string
  }
}
interface FrontmatterErr {
  ok: false
  error: string
}

/** SKILL.md 文本按 `---` 分割取首段 yaml → skillFrontmatterSchema.safeParse */
function parseSkillFrontmatter(text: string): FrontmatterOk | FrontmatterErr {
  // frontmatter 形如：---\n<yaml>\n---\n...  取首对 --- 之间内容
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) {
    return { ok: false, error: 'frontmatter 边界缺失（未找到首对 ---）' }
  }
  const fmText = m[1]
  if (!fmText) {
    return { ok: false, error: 'frontmatter 为空' }
  }
  let doc: unknown
  try {
    doc = yaml.load(fmText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `yaml 解析失败：${msg}` }
  }
  if (typeof doc !== 'object' || doc === null) {
    return { ok: false, error: 'frontmatter 顶层非对象' }
  }
  const r = skillFrontmatterSchema.safeParse(doc)
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: issues }
  }
  return { ok: true, value: r.data }
}

// ---------- 内部辅助（暂留为后续扩展锚） ----------

/** 目录递归读（暂未使用，留作文档扫描等扩展位） */
function _walkDir(root: string, cb: (abs: string, rel: string) => void): void {
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = join(root, entry)
    let isDir = false
    let isFile = false
    try {
      const s = statSync(abs)
      isDir = s.isDirectory()
      isFile = s.isFile()
    } catch {
      continue
    }
    if (isDir) {
      _walkDir(abs, (a, r) => cb(a, `${entry}/${r}`))
    } else if (isFile) {
      cb(abs, entry)
    }
  }
}
