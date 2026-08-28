#!/usr/bin/env bun
/**
 * 模板资产 codegen（Task 6 / B1，设计 P1 决策：bun --compile 单体编译期嵌入源）
 *
 *   扫 workbench/templates/ 全部文件 → 生成 src/assets/templates.gen.ts
 *   提交进仓沿 web-dist/index.html 先例（commit 在仓即可，编译期 fs 扫描对单体不可用）。
 *
 *   守纪律：
 *   - 路径分隔统一 `/`（Windows 下 relative 给 `\\`，统一替换）
 *   - 键序按字典升序排列，重跑两次 diff 零变化（评审硬线）
 *   - 二进制文件检测：NUL 字节或 UTF-8 解码非幂等即报错阻止（保护物料不被损坏）
 *   - 脚本按自身路径定位 templates/，不依赖 cwd
 */

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(SCRIPT_PATH)
// scripts/ → workbench-service/ → workbench/ → templates/
const TPL_ROOT = join(SCRIPT_DIR, '..', '..', 'templates')
const OUT_DIR = join(SCRIPT_DIR, '..', 'src', 'assets')
const OUT_FILE = join(OUT_DIR, 'templates.gen.ts')

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      walk(p, acc)
    } else {
      acc.push(p)
    }
  }
  return acc
}

const files = walk(TPL_ROOT)
const relPaths = files
  .map((p) => relative(TPL_ROOT, p).split('\\').join('/'))
  .sort()

const entries: string[] = []
for (const rel of relPaths) {
  const buf = readFileSync(join(TPL_ROOT, rel))
  // 二进制检测 1：NUL 字节
  if (buf.includes(0)) {
    throw new Error(
      `拒绝内联二进制文件：${rel}（含 NUL 字节）——gen:templates 仅支持 UTF-8 文本物料`,
    )
  }
  const text = buf.toString('utf8')
  // 二进制检测 2：解码后再编码应字节级一致（防止无效 UTF-8 静默替换为 U+FFFD）
  if (Buffer.from(text, 'utf8').length !== buf.length) {
    throw new Error(
      `UTF-8 解码非幂等：${rel}（疑似含无效 UTF-8 序列）——gen:templates 拒绝损坏内容`,
    )
  }
  entries.push(`  ${JSON.stringify(rel)}: ${JSON.stringify(text)},`)
}

mkdirSync(OUT_DIR, { recursive: true })

const out = [
  '// 生成产物：bun run gen:templates 重新生成，勿手改',
  '// 源：workbench/templates/（路径分隔 /，键序按字典升序保证 diff 干净）',
  'export const builtinTemplates: Record<string, string> = {',
  ...entries,
  '}',
  '',
].join('\n')

writeFileSync(OUT_FILE, out, 'utf8')

console.log(
  `gen: ${entries.length} 个模板文件 → ${relative(join(SCRIPT_DIR, '..'), OUT_FILE)}`,
)
