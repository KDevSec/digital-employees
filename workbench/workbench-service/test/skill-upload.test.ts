/**
 * skill-upload 单元测试（Task 12 / C1 / E-13）。
 *
 * 五种防护 + 物化 + 布局兼容 + frontmatter 校验 + sha256：
 *   ① 根 SKILL.md 布局 → UploadedSkill + tmp 落盘
 *   ② 顶层目录 sec-x/SKILL.md 布局 → 剥层
 *   ③ 无 SKILL.md → SkillLayoutError
 *   ④ entry 名 `../evil.txt` → SkillZipError（zip-slip）
 *   ⑤ 坏 frontmatter（description 太短）→ SkillLayoutError
 *   ⑥ 同名二次上传覆盖幂等
 *   ⑦ version 缺省 '0.1.0'（frontmatter 无 version 键）
 *   ⑧ GBK 文件名 fixture → 解码或保留（断言不抛错 + files 非空）
 *   ⑨ 限额：解压后总字节 >50MB → SkillZipError
 *   ⑩ 限额：文件数 >2000 → SkillZipError
 *
 * fixture zip 全部现场用 fflate.zipSync 造（无外部 fixture 文件依赖）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  SkillLayoutError,
  SkillZipError,
  uploadSkillZip,
} from '../src/employees/skill-upload'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wb-skill-upload-'))
})

/** 现场造一个根布局 zip：根 SKILL.md + references/x.md */
function makeRootLayoutZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(
      '---\nname: root-skill\ndescription: a root layout skill fixture\nversion: 1.2.3\n---\nbody\n',
    ),
    'references/x.md': strToU8('# x\n'),
  })
}

/** 现场造一个顶层目录布局 zip：sec-x/SKILL.md + sec-x/references/y.md */
function makeTopDirLayoutZip(): Uint8Array {
  return zipSync({
    'sec-x/SKILL.md': strToU8(
      '---\nname: sec-x\ndescription: a top dir layout skill fixture\n---\nbody\n',
    ),
    'sec-x/references/y.md': strToU8('# y\n'),
  })
}

/** 造一个无 SKILL.md 的 zip */
function makeNoSkillMdZip(): Uint8Array {
  return zipSync({
    'README.md': strToU8('# readme\n'),
    'references/x.md': strToU8('# x\n'),
  })
}

/** 造一个 zip-slip entry 的 zip（fflate.zipSync 接受任意字符串名，包括 `../evil.txt`） */
function makeZipSlipZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(
      '---\nname: slip-skill\ndescription: a zip slip attempt fixture\n---\nbody\n',
    ),
    '../evil.txt': strToU8('pwned\n'),
  })
}

/** 造一个坏 frontmatter 的 zip（description < 10 字） */
function makeBadFrontmatterZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(
      '---\nname: bad-skill\ndescription: short\n---\nbody\n',
    ),
  })
}

/** 造一个无 version 键的 zip（验证缺省 '0.1.0'） */
function makeNoVersionZip(): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(
      '---\nname: no-ver-skill\ndescription: no version key in frontmatter\n---\nbody\n',
    ),
  })
}

/**
 * 造一个 GBK 文件名的 zip：用 zipSync 造正常 ASCII 名 zip 后手工 patch 字节，
 * 把占位名替换为 GBK 字节（"中文.md" = 0xd6d0 0xcec4 0x2e 0x6d 0x64）并清 UTF-8 flag。
 * 这样 fflate.unzipSync 出的 entry 名会经过 Latin-1/UTF-8 路径，触发我们的 GBK 重解码。
 * 含 SKILL.md 以满足布局校验。
 */
function makeGbkNamedZip(): Uint8Array {
  const placeholder = 'XXXXX.md' // 7 bytes = same length as GBK "中文.md" (2+2+3 bytes)
  const content = strToU8('# gbk-name\n')
  const skillMd = strToU8(
    '---\nname: gbk-skill\ndescription: a skill with a gbk-named file fixture\n---\nbody\n',
  )
  const zipped = zipSync({
    'SKILL.md': skillMd,
    [placeholder]: content,
  })

  // GBK 字节 for "中文.md" (no UTF-8 flag → fflate returns Latin-1 high-bit chars)
  const gbkName = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x6d, 0x64])

  // 找到 placeholder 在 zipped 中的两处出现位置（local file header + central directory header）
  const phBytes = strToU8(placeholder)
  const positions: number[] = []
  for (let i = 0; i <= zipped.length - phBytes.length; i++) {
    let match = true
    for (let j = 0; j < phBytes.length; j++) {
      if (zipped[i + j] !== phBytes[j]) {
        match = false
        break
      }
    }
    if (match) positions.push(i)
  }
  if (positions.length !== 2) {
    throw new Error(`placeholder not found exactly twice: ${positions.length}`)
  }

  const patched = new Uint8Array(zipped)
  for (const pos of positions) {
    patched.set(gbkName, pos)
    // 清 GP flag（bit 11 = 0x0800 = UTF-8 flag）—— 区分 local file header / central directory header
    // local file header: name 在 +30，GP flag 在 +6（2 字节）；central: name 在 +46，GP flag 在 +8（2 字节）
    // 第一处出现位于文件数据前（local），第二处位于文件数据后（central dir）
    const isLocal = pos < zipped.length / 2
    const flagOffset = isLocal ? pos - 30 + 6 : pos - 46 + 8
    patched[flagOffset] = 0
    patched[flagOffset + 1] = 0
  }

  return patched
}

describe('uploadSkillZip —— 五种防护 + 物化', () => {
  it('① 根 SKILL.md 布局 → UploadedSkill + tmp 落盘', async () => {
    const zipBytes = makeRootLayoutZip()
    const result = await uploadSkillZip(zipBytes, 'root.zip', tmpRoot)

    expect(result.name).toBe('root-skill')
    expect(result.version).toBe('1.2.3')
    expect(result.source_type).toBe('local')
    expect(result.origin).toBe('root.zip')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.files).toEqual(expect.arrayContaining(['SKILL.md', 'references/x.md']))

    // 落盘验证
    const skillDir = join(tmpRoot, 'skills', 'root-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir, 'references', 'x.md'))).toBe(true)
    const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: root-skill')
  })

  it('② 顶层目录 sec-x/SKILL.md 布局 → 剥层（files 不带 sec-x/ 前缀）', async () => {
    const zipBytes = makeTopDirLayoutZip()
    const result = await uploadSkillZip(zipBytes, 'sec.zip', tmpRoot)

    expect(result.name).toBe('sec-x')
    expect(result.files).toEqual(expect.arrayContaining(['SKILL.md', 'references/y.md']))

    // 落盘验证：剥层后直接在 skills/sec-x/ 下
    const skillDir = join(tmpRoot, 'skills', 'sec-x')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir, 'references', 'y.md'))).toBe(true)
  })

  it('③ 无 SKILL.md → SkillLayoutError', async () => {
    const zipBytes = makeNoSkillMdZip()
    await expect(uploadSkillZip(zipBytes, 'no-skill.zip', tmpRoot)).rejects.toBeInstanceOf(SkillLayoutError)
  })

  it('④ entry 名 `../evil.txt` → SkillZipError（zip-slip）', async () => {
    const zipBytes = makeZipSlipZip()
    await expect(uploadSkillZip(zipBytes, 'slip.zip', tmpRoot)).rejects.toBeInstanceOf(SkillZipError)
  })

  it('④b entry 名 `C:\\evil.txt` → SkillZipError（Windows 盘符 zip-slip）', async () => {
    const zipBytes = zipSync({
      'SKILL.md': strToU8(
        '---\nname: drive-skill\ndescription: a drive letter slip attempt fixture\n---\nbody\n',
      ),
      'C:\\evil.txt': strToU8('pwned\n'),
    })
    await expect(uploadSkillZip(zipBytes, 'drive.zip', tmpRoot)).rejects.toBeInstanceOf(SkillZipError)
  })

  it('⑤ 坏 frontmatter（description 太短）→ SkillLayoutError（带 zod issue 信息）', async () => {
    const zipBytes = makeBadFrontmatterZip()
    let err: unknown
    try {
      await uploadSkillZip(zipBytes, 'bad.zip', tmpRoot)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SkillLayoutError)
    expect((err as Error).message).toMatch(/description|too_small|frontmatter/i)
  })

  it('⑥ 同名二次上传覆盖幂等（frontmatter name 相同 → 同一目录，旧文件清空）', async () => {
    // 第一次：根布局 root-skill v1.2.3 + references/x.md
    const zip1 = makeRootLayoutZip()
    const r1 = await uploadSkillZip(zip1, 'root.zip', tmpRoot)
    expect(r1.name).toBe('root-skill')
    const skillDir = join(tmpRoot, 'skills', 'root-skill')
    expect(existsSync(join(skillDir, 'references', 'x.md'))).toBe(true)

    // 第二次：同名 root-skill，但内容不同（references/z.md 替代 x.md）
    const zip2 = zipSync({
      'SKILL.md': strToU8(
        '---\nname: root-skill\ndescription: a root layout skill fixture\nversion: 2.0.0\n---\nbody v2\n',
      ),
      'references/z.md': strToU8('# z\n'),
    })
    const r2 = await uploadSkillZip(zip2, 'root-v2.zip', tmpRoot)
    expect(r2.name).toBe('root-skill')
    expect(r2.version).toBe('2.0.0')

    // 旧文件 references/x.md 应已清空，新文件 references/z.md 存在
    expect(existsSync(join(skillDir, 'references', 'x.md'))).toBe(false)
    expect(existsSync(join(skillDir, 'references', 'z.md'))).toBe(true)
    // SKILL.md 内容更新
    const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('2.0.0')
  })

  it('⑦ version 缺省 0.1.0（frontmatter 无 version 键）', async () => {
    const zipBytes = makeNoVersionZip()
    const result = await uploadSkillZip(zipBytes, 'no-ver.zip', tmpRoot)
    expect(result.name).toBe('no-ver-skill')
    expect(result.version).toBe('0.1.0')
  })

  it('⑧ GBK 文件名 fixture → 不抛错 + files 非空（解码或保留均接受）', async () => {
    const zipBytes = makeGbkNamedZip()
    const result = await uploadSkillZip(zipBytes, 'gbk.zip', tmpRoot)
    expect(result.files.length).toBeGreaterThan(0)
    // 至少有 SKILL.md（无论 GBK 名是否解码，主文件 SKILL.md 是 ASCII）
    expect(result.files).toContain('SKILL.md')
  })

  it('⑧b GBK 解码路径：fflate 出的 Latin-1 名经 TextDecoder("gbk") 重解码为 "中文.md"', () => {
    // 直接验证解码逻辑（不依赖 fixture patch）：Latin-1 高位字符 → GBK 解码
    const latin1Name = String.fromCharCode(0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x6d, 0x64)
    const buf = Uint8Array.from(latin1Name, (c) => c.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('gbk').decode(buf)
    expect(decoded).toBe('中文.md')
  })

  it('⑨ 限额：解压后总字节 >50MB → SkillZipError', async () => {
    // 造一个总字节超 50MB 的 zip（单个 51MB 文件）
    const big = new Uint8Array(51 * 1024 * 1024)
    const zipBytes = zipSync({
      'SKILL.md': strToU8(
        '---\nname: big-skill\ndescription: a skill with a big file fixture\n---\nbody\n',
      ),
      'big.bin': big,
    })
    await expect(uploadSkillZip(zipBytes, 'big.zip', tmpRoot)).rejects.toBeInstanceOf(SkillZipError)
  })

  it('⑩ 限额：文件数 >2000 → SkillZipError', async () => {
    // 造一个文件数超 2000 的 zip（2001 个空文件 + SKILL.md）
    const files: Record<string, Uint8Array> = {
      'SKILL.md': strToU8(
        '---\nname: many-skill\ndescription: a skill with too many files fixture\n---\nbody\n',
      ),
    }
    for (let i = 0; i < 2001; i++) {
      files[`f${i}.txt`] = strToU8('x\n')
    }
    const zipBytes = zipSync(files)
    await expect(uploadSkillZip(zipBytes, 'many.zip', tmpRoot)).rejects.toBeInstanceOf(SkillZipError)
  })

  it('sha256 = 原始 zipBytes 的 hash（同一 zip 二次上传 sha256 一致）', async () => {
    const zipBytes = makeRootLayoutZip()
    const r1 = await uploadSkillZip(zipBytes, 'root.zip', tmpRoot)
    // 二次上传不同内容（不同 sha256）；用同名不同 zip 验证 sha256 是 zipBytes 的函数
    const otherZip = makeNoVersionZip()
    const r2 = await uploadSkillZip(otherZip, 'no-ver.zip', tmpRoot)
    expect(r1.sha256).not.toBe(r2.sha256)
    // 直接验证 sha256 = sha256(zipBytes)（用 node:crypto 与实现同源，验证 hash 函数选择）
    const expected = createHash('sha256').update(zipBytes).digest('hex')
    expect(r1.sha256).toBe(expected)
  })

  it('zip 目录名与 frontmatter name 不一致 → 以 frontmatter name 重命名目录', async () => {
    // zip 顶层目录是 sec-x，但 frontmatter name 是 renamed-skill
    const zipBytes = zipSync({
      'sec-x/SKILL.md': strToU8(
        '---\nname: renamed-skill\ndescription: a renamed skill fixture here\n---\nbody\n',
      ),
    })
    const result = await uploadSkillZip(zipBytes, 'rename.zip', tmpRoot)
    expect(result.name).toBe('renamed-skill')
    // 物化目录是 frontmatter name，不是 zip 目录名 sec-x
    const skillDir = join(tmpRoot, 'skills', 'renamed-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'skills', 'sec-x'))).toBe(false)
  })
})
