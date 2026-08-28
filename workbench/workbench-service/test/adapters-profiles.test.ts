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

  it('auth 置备分档：CC=软链一件（env-token 降级）/ qoder=拷贝两件（P-6\' 1.1.32）/ CB=none（429 待复验）', () => {
    expect(baseProfiles['claude-code'].auth).toMatchObject({ kind: 'symlink', files: ['.credentials.json'] })
    // M2 实测：本机 CC 为 env token 形态（无 .credentials.json）--缺失时按 envTokenKeys 降级零置备（§5.1 auth 分档）
    expect(baseProfiles['claude-code'].auth.envTokenKeys).toEqual(['ANTHROPIC_AUTH_TOKEN'])
    expect(baseProfiles['qoder'].auth).toMatchObject({
      kind: 'copy',
      files: ['installation_id', '.auth'], // P-6' 1.1.32 复验：两件即恢复登录态（state.json 1.1.29+ 域内已无）
    })
    expect(baseProfiles['codebuddy'].auth).toMatchObject({ kind: 'none', files: [] })
  })

  it('版本基线：qoder version_tested 1.1.32（M2 实测）/ version_min 维持 1.1.26 宽下限', () => {
    expect(baseProfiles['qoder'].version_tested).toBe('1.1.32')
    expect(baseProfiles['qoder'].version_min).toBe('1.1.26')
  })

  it('launch 配置注入：CC/CB 走 env，qoder 走 --config-dir 旗标（⏳ M2 实测核）', () => {
    expect(baseProfiles['claude-code'].launch.configEnv).toBe('CLAUDE_CONFIG_DIR')
    expect(baseProfiles['codebuddy'].launch.configEnv).toBe('CODEBUDDY_CONFIG_DIR')
    expect(baseProfiles['qoder'].launch.configFlag).toBe('--config-dir')
  })
})
