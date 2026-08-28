import { describe, expect, it } from 'vitest'
import { listModelsFor } from '../src/adapters/common/models'
import { resolveTierModel } from '../src/adapters/common/tier-map'
import { createClaudeCodeAdapter } from '../src/adapters/claude-code/index'

describe('listModels / tier-map（D-046 四层链数据源；⏳ 真实获取方式 M2 清单 6 收口——本任务静态桩）', () => {
  it('三底座各返回非空模型清单，字段 {id,label,tier?}', async () => {
    for (const base of ['claude-code', 'codebuddy', 'qoder'] as const) {
      const models = await listModelsFor(base)
      expect(models.length).toBeGreaterThan(0)
      for (const m of models) {
        expect(typeof m.id).toBe('string')
        expect(typeof m.label).toBe('string')
      }
    }
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
})
