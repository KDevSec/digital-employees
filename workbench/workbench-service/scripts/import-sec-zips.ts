#!/usr/bin/env bun
/**
 * 一次性导入脚本（Task 20 / D4）：解包两 sec skill zip → 落仓 workbench/templates/<tpl>/skills/<skill>/
 *
 * 来源 zip（仓外，只读）：
 *   - sec-scan-design-20260626.021720.zip（16 文件：SKILL.md + references/×15 GBK 文件名）
 *   - sec-scan-code-20260803.004810.zip（86 文件：SKILL.md + bin/*.py + rules/ + secscancode/ + 排除项）
 *
 * 排除规则（sec-code）：
 *   - .venv.rar（40MB 二进制——员工 home 安装语义归 L2 运行时，Q3/D-044）
 *   - __pycache__（.pyc 二进制 + 缓存）
 *   - install.ps1 / install.sh（安装脚本不进包——安装语义归 L2 运行时）
 *   - .codebuddy.zip / .trae.zip（平台特定重打包，二进制——gen:templates 拒二进制）
 *
 * GBK 文件名：fflate 解 zip 时按 UTF-8 解码文件名——sec-design 的 GBK 字节序列恰好是有效
 * UTF-8（中文字符落 CJK Unified Ideographs 段，UTF-8 编码 3 字节/字），fflate 解出即正确
 * 中文文件名；Python zipfile 按 cp437 解会乱码（zip 头未设 UTF-8 标志位但字节确是 UTF-8）。
 *
 * 用法：bun run scripts/import-sec-zips.ts
 * 留仓供追溯——一次性导入，不重跑（重跑会覆盖）。
 */
import { unzipSync } from 'fflate'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ZIP_DIR = 'D:/Works/AI Coding/digital-employees/reference-projects/安全skill'
const TPL_ROOT = join(import.meta.dir, '..', '..', 'templates')

const SKILLS = [
  {
    zip: 'sec-scan-design-20260626.021720.zip',
    dest: join(TPL_ROOT, 'sec-design', 'skills', 'sec-scan-design'),
    exclude: [] as string[],
  },
  {
    zip: 'sec-scan-code-20260803.004810.zip',
    dest: join(TPL_ROOT, 'sec-code', 'skills', 'sec-scan-code'),
    exclude: ['.venv.rar', '__pycache__', 'install.ps1', 'install.sh', '.codebuddy.zip', '.trae.zip'],
  },
] as const

function isExcluded(name: string, excludes: readonly string[]): boolean {
  return excludes.some((ex) => name.includes(ex))
}

/**
 * decodeFilename — fflate 解 zip 时按 UTF-8 解码文件名，本批 sec-design zip 的 GBK 字节恰好
 * 是有效 UTF-8（中文落 CJK Unified Ideographs 段，UTF-8 编码 3 字节/字），解出即正确中文。
 *
 * 防御面向未来重跑（I2）：若 filename 含 U+FFFD（UTF-8 解码失败替换符），尝试 latin1 取原始
 * 字节再 GBK 解码兜底。注意 fflate 解码失败时原始多字节序列可能已合并为 U+FFFD，此通道为
 * best-effort——当前数据不触发，留作未来 GBK-only zip 的防御。
 */
function decodeFilename(name: string): string {
  if (!name.includes('�')) return name
  try {
    const latin1Bytes = Buffer.from(name, 'latin1')
    return new TextDecoder('gbk').decode(latin1Bytes)
  } catch {
    return name // GBK 解码也失败，返回原样（best-effort）
  }
}

function sanitizePath(name: string): string {
  // zip-slip 防护 + 路径分隔统一
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.includes('../')) {
    throw new Error(`zip-slip 拒绝：${name}`)
  }
  return normalized
}

let totalFiles = 0
for (const skill of SKILLS) {
  const zipPath = join(ZIP_DIR, skill.zip)
  if (!existsSync(zipPath)) {
    console.error(`zip 缺失：${zipPath}`)
    process.exit(1)
  }
  const buf = readFileSync(zipPath)
  const unzipped = unzipSync(new Uint8Array(buf))
  console.log(`--- ${skill.zip} → ${skill.dest} ---`)
  console.log(`  zip 内文件数：${Object.keys(unzipped).length}`)

  let kept = 0
  let excluded = 0
  for (const [name, content] of Object.entries(unzipped)) {
    const decodedName = decodeFilename(name)
    if (isExcluded(decodedName, skill.exclude)) {
      excluded++
      continue
    }
    const rel = sanitizePath(decodedName)
    // 二进制检测：NUL 字节 → 拒（gen:templates 也会拒，提前拦）
    if (content.includes(0)) {
      console.warn(`  ⚠ 跳过二进制：${rel}（含 NUL 字节）`)
      excluded++
      continue
    }
    const outPath = join(skill.dest, rel)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, content)
    kept++
    totalFiles++
  }
  console.log(`  保留：${kept}，排除：${excluded}`)
}

console.log(`\n总计写入：${totalFiles} 文件`)
