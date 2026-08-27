import { describe, expect, it } from 'vitest'
import { baseProfiles } from '../src/adapters/index'
import type { BaseId } from '../src/adapters/contract'

describe('三底座档案（设计 §5.1；TS 常量——bun --compile 单体约束）', () => {
  it('三底座齐备且 id 唯一', () => {
    expect(Object.keys(baseProfiles).sort()).toEqual(['claude-code', 'codebuddy', 'qoder'])
    for (const p of Object.values(baseProfiles)) {
      expect(baseProfiles[p.id]).toBe(p)
    }
  })

  it('身份锚三底座统一 config-domain（D-L2-01 主路径）', () => {
    for (const p of Object.values(baseProfiles)) {
      expect(p.identity_anchor).toBe('config-domain')
    }
  })

  it('域内身份文件名各异：CLAUDE.md / CODEBUDDY.md / AGENTS.md', () => {
    expect(baseProfiles['claude-code'].identity_file).toBe('CLAUDE.md')
    expect(baseProfiles['codebuddy'].identity_file).toBe('CODEBUDDY.md')
    expect(baseProfiles['qoder'].identity_file).toBe('AGENTS.md')
  })

  it('provides 覆盖 L2 能力全集（PR-024：CC 同构声明）', () => {
    const l2set = ['agent-def', 'fs-access', 'skill-def', 'bash-exec', 'slash-command', 'subagent-dispatch']
    for (const p of Object.values(baseProfiles)) {
      expect(p.provides).toEqual(expect.arrayContaining(l2set))
    }
  })

  it('探测命令：qoder 用 qodercli（D-034；qoder 是 IDE 启动器）', () => {
    expect(baseProfiles['qoder'].command).toBe('qodercli')
    expect(baseProfiles['claude-code'].command).toBe('claude')
    expect(baseProfiles['codebuddy'].command).toBe('codebuddy')
  })

  it('auth 置备分档：CC=软链一件 / qoder=拷贝三件套 / CB=none（429 待复验）', () => {
    expect(baseProfiles['claude-code'].auth).toMatchObject({ kind: 'symlink', files: ['.credentials.json'] })
    expect(baseProfiles['qoder'].auth).toMatchObject({
      kind: 'copy',
      files: expect.arrayContaining(['installation_id', 'state.json', '.auth']),
    })
    expect(baseProfiles['codebuddy'].auth).toMatchObject({ kind: 'none', files: [] })
  })

  it('launch 配置注入：CC/CB 走 env，qoder 走 --config-dir 旗标（⏳ M2 实测核）', () => {
    expect(baseProfiles['claude-code'].launch.configEnv).toBe('CLAUDE_CONFIG_DIR')
    expect(baseProfiles['codebuddy'].launch.configEnv).toBe('CODEBUDDY_CONFIG_DIR')
    expect(baseProfiles['qoder'].launch.configFlag).toBe('--config-dir')
  })
})
