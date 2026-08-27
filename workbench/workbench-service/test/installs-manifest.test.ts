import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest, sha256File, verifyManifest } from '../src/installs/manifest'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'

let home: string

async function setup(): Promise<{ manifest: ReturnType<typeof buildManifest> }> {
  home = mkdtempSync(join(tmpdir(), 'wb-manifest-'))
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', 'CLAUDE.md'), '# generated\n身份内容', 'utf8')
  mkdirSync(join(home, 'config', 'skills', 'tdd-methodology'), { recursive: true })
  writeFileSync(join(home, 'config', 'skills', 'tdd-methodology', 'SKILL.md'), '---\nname: tdd\n---\n', 'utf8')
  const spec = await parsePackage(fixturePackageDir())
  return { manifest: buildManifest({ spec, base: 'claude-code', home }) }
}

describe('manifest（.devzero-manifest.json——设计 §3.1/§7）', () => {
  it('sha256File 输出 hex 且稳定', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'wb-sha-')), 'f.txt')
    writeFileSync(p, 'abc', 'utf8')
    expect(sha256File(p)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256File(p)).toBe(sha256File(p))
  })

  it('buildManifest 收录 home 下全部产物（config/ 内文件 + 无用户资产）', async () => {
    const { manifest } = await setup()
    expect(manifest.manifest_version).toBe(1)
    expect(manifest.employee_id).toBe('dev-lite')
    expect(manifest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['config/CLAUDE.md', 'config/skills/tdd-methodology/SKILL.md']),
    )
  })

  it('verifyManifest：域完好 → 空；改文件 → hash-mismatch；删文件 → missing；多余产物 → extra', async () => {
    const { manifest } = await setup()
    expect(verifyManifest(home, manifest)).toEqual([])

    writeFileSync(join(home, 'config', 'CLAUDE.md'), '# 用户手改', 'utf8')
    expect(verifyManifest(home, manifest).map((d) => `${d.kind}:${d.path}`)).toContain('hash-mismatch:config/CLAUDE.md')

    rmSync(join(home, 'config', 'skills', 'tdd-methodology', 'SKILL.md'))
    expect(verifyManifest(home, manifest).map((d) => d.kind)).toContain('missing')

    writeFileSync(join(home, 'config', 'stray.txt'), 'x', 'utf8')
    expect(verifyManifest(home, manifest).map((d) => d.kind)).toContain('extra')
  })

  it('memory/ 与 sessions/ 不进 manifest（用户资产豁免）', async () => {
    const { manifest } = await setup()
    mkdirSync(join(home, 'memory'), { recursive: true })
    writeFileSync(join(home, 'memory', 'notes.md'), '用户记忆', 'utf8')
    expect(verifyManifest(home, manifest)).toEqual([])   // memory 变动不产生 extra
    expect(manifest.files.some((f) => f.path.startsWith('memory/'))).toBe(false)
  })
})
