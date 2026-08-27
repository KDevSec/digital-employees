import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 依赖方向审计（L5 v0.2，用户硬约束——「mock 绝不自动启动，默认接入真实接口」的机器化验证）：
 * 1. 产品代码（src/）不得 import fixtures/scripts——mock/剧本只允许存在于测试与 scripts，
 *    bundle 隔离（构建期 grep）之外再加源码级双保险；
 * 2. npm scripts 不得含 mock 启动（无自动启动路径——mock 只能手动 `bun scripts/...` 起）；
 * 3. dev 代理默认必须指向真实 service（19980）——只有显式 VITE_PROXY_TARGET 才可改。
 * 有人无意违反任一条（import fixture 进产品 / 加 predev 起 mock / 改默认代理），此测试变红。
 */

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|vue)$/.test(name)) out.push(full)
  }
  return out
}

const ROOT = join(__dirname, '..')

describe('依赖方向审计：mock 不进产品路径', () => {
  it('src/ 全部 ts/vue 零 import fixtures 或 scripts（静态与动态均拦）', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'src'))) {
      const content = readFileSync(file, 'utf8')
      const importRe = /from\s+['"][^'"]*(fixtures|scripts)\//.test(content)
      const dynamicRe = /import\(\s*['"][^'"]*(fixtures|scripts)\//.test(content)
      if (importRe || dynamicRe) offenders.push(file)
    }
    expect(offenders, '产品代码引用了 fixtures/scripts（mock 只允许测试与 scripts 域）').toEqual([])
  })

  it('package.json scripts 零 mock 引用（无自动启动路径——mock 只能手动起）', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const offenders = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) =>
      /mock/i.test(cmd),
    )
    expect(offenders, 'npm script 里出现了 mock 启动命令').toEqual([])
  })

  it('vite dev 代理默认指向真实 service 19980（mock 19990 只可显式 VITE_PROXY_TARGET 指定）', () => {
    const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(viteConfig).toContain(`?? 'http://127.0.0.1:19980'`)
    // 19990（mock 端口）不得以默认值身份出现
    expect(viteConfig.includes('19990')).toBe(false)
  })
})
