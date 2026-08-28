import { describe, expect, it } from 'vitest'
import { listModelsFor, parseCodebuddyHelp } from '../src/adapters/common/models'
import { resolveTierModel } from '../src/adapters/common/tier-map'
import { createClaudeCodeAdapter } from '../src/adapters/claude-code/index'
import { createQoderAdapter } from '../src/adapters/qoder/index'
import type { CmdRunner } from '../src/bases/probe'

/** 本机实测 qodercli --list-models 未登录：exit 1 + stderr 此句（PowerShell 走 NativeCommandError） */
const QODER_NOT_LOGGED_IN = 'Not logged in. Run `qodercli login` to authenticate.\n'

describe('listModels（D-bb01：Qoder CLI 真模型；未登录 ≠ 空列表）', () => {
  it('Qoder 未登录：--list-models 给出 NOT_LOGGED_IN，不返回空模型数组', async () => {
    const run: CmdRunner = async (command, args) => {
      expect(command).toBe('qodercli')
      expect(args).toEqual(['--list-models'])
      return { code: 1, stdout: '', stderr: QODER_NOT_LOGGED_IN }
    }
    const result = await listModelsFor('qoder', run)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_LOGGED_IN')
    expect(result.message).toBe('登录后可见')
  })

  it('Qoder 已登录：解析 --list-models 每行一个模型 id（口径来自 Qoder 文档 --model auto/efficient）', async () => {
    const run: CmdRunner = async () => ({
      code: 0,
      stdout: 'auto\nefficient\nultimate\n',
      stderr: '',
    })
    const result = await listModelsFor('qoder', run)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toEqual([
      { id: 'auto', label: 'auto' },
      { id: 'efficient', label: 'efficient' },
      { id: 'ultimate', label: 'ultimate' },
    ])
  })

  it('Qoder CLI 不在场（非零退出且无登录文案）不伪装成空模型列表', async () => {
    const run: CmdRunner = async () => ({ code: 127, stdout: '', stderr: '' })
    const result = await listModelsFor('qoder', run)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CLI_FAILED')
  })
})

describe('listModels / tier-map（D-046 第四层仍走档位表；CC 页隐藏可留桩）', () => {
  it('claude-code 页隐藏仍返回档位桩 {id,label,tier?}', async () => {
    const result = await listModelsFor('claude-code')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models.length).toBeGreaterThan(0)
    expect(result.models.some((m) => m.tier === '编码档')).toBe(true)
  })

  it('codebuddy --help 无 Currently supported 段：CLI_FAILED 尚未登记，不造档位桩', async () => {
    const run: CmdRunner = async (command, args) => {
      expect(command).toBe('codebuddy')
      expect(args).toEqual(['--help'])
      return { code: 0, stdout: 'Usage: codebuddy [options]\n--model <model>  Provide the model ID.\n', stderr: '' }
    }
    const result = await listModelsFor('codebuddy', run)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CLI_FAILED')
    expect(result.message).toBe('模型命令尚未登记')
  })

  it('codebuddy --help 有括号段：非空 id 列表，形态合法，无说明文字残留（名单/条数不钉）', async () => {
    const run: CmdRunner = async () => ({
      code: 0,
      stdout: '  --model <model>  Please provide the model ID. Currently\n  supported: (mod-a, mod-b.1, not a model!, mod-c)\n',
      stderr: '',
    })
    const result = await listModelsFor('codebuddy', run)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models.length).toBeGreaterThan(0)
    const idRe = /^[a-z0-9][a-z0-9.\-]*$/i
    for (const m of result.models) {
      expect(m.id).toMatch(idRe)
      expect(m.label).toBe(m.id)
      expect(m.id).not.toMatch(/[()]/)
      expect(m.id.toLowerCase()).not.toContain('supported')
      expect(m.id).not.toMatch(/\s/)
    }
  })

  it('parseCodebuddyHelp：段缺失或零合法 id → 空数组（调用方 fail-closed）', () => {
    expect(parseCodebuddyHelp('Usage: codebuddy --help')).toEqual([])
    expect(parseCodebuddyHelp('Currently supported: (not valid!, also bad)')).toEqual([])
  })

  it('五档 tier-map：每档解析出具体模型（tier → ModelInfo）', () => {
    for (const tier of ['评审安全档', '设计档', '探索档', '编码档', '执行档'] as const) {
      const m = resolveTierModel('claude-code', tier)
      expect(m.id).toBeTruthy()
    }
  })

  it('qoder 内置默认表按 --list-models 实测校准（P-21：qoder-max 实测 not available 废除；Qwen3.8 系补入）', () => {
    // D-062 内置默认（实测清单 Lite/Qwen3.8-Max/Qwen3.8-Flash/Qwen3.7-Max/Qwen3.7-Plus）
    expect(resolveTierModel('qoder', '评审安全档').id).toBe('Qwen3.8-Max')
    expect(resolveTierModel('qoder', '设计档').id).toBe('Qwen3.7-Max')
    expect(resolveTierModel('qoder', '探索档').id).toBe('Qwen3.8-Max')
    expect(resolveTierModel('qoder', '编码档').id).toBe('Qwen3.7-Plus')
    expect(resolveTierModel('qoder', '执行档').id).toBe('Lite')
    // 废除的旧静态 id 不得回潮
    const qoderIds = new Set(['评审安全档', '设计档', '探索档', '编码档', '执行档']
      .map((t) => resolveTierModel('qoder', t as '评审安全档').id))
    expect(qoderIds.has('qoder-max')).toBe(false)
    expect(qoderIds.has('qoder-pro')).toBe(false)
    expect(qoderIds.has('qoder-lite')).toBe(false)
  })

  it('adapter.listModels 透传（CC adapter）', async () => {
    const models = await createClaudeCodeAdapter().listModels()
    expect(models.some((m) => m.tier === '编码档')).toBe(true)
  })

  it('Qoder adapter.listModels 走注入的 CmdRunner，不是空列表', async () => {
    const run: CmdRunner = async (command, args) => {
      expect(command).toBe('qodercli')
      expect(args).toEqual(['--list-models'])
      return { code: 0, stdout: 'auto\n', stderr: '' }
    }
    await expect(createQoderAdapter().listModels(run)).resolves.toEqual([{ id: 'auto', label: 'auto' }])
  })
})
