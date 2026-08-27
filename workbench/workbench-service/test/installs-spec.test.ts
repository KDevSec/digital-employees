import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixturePackageDir, parsePackage } from '../src/installs/spec/parser'

describe('parsePackage（fixture 员工包 → EmployeeSpec，manifest 八类 v0.2 对齐）', () => {
  it('解析出全部消费面字段', async () => {
    const spec = await parsePackage(fixturePackageDir())
    expect(spec.id).toBe('dev-lite')
    expect(spec.display).toBe('轻量开发员工')
    expect(spec.version).toBe('0.1.0')
    expect(spec.instructions).toContain('# 我是谁')
    expect(spec.instructions).toContain('本角色为用户配置的数字员工岗位')
    expect(spec.skills).toEqual([{ name: 'tdd-methodology', version: '1.0.0', source_type: 'template' }])
    expect(spec.requires.level).toBe('L2')
    expect(spec.tier).toBe('编码档')
    expect(spec.connectors).toEqual([])
    expect(spec.hooksFile).toBe('hooks/hooks.json')
  })

  it('requires.capabilities 按派生表推导（skills 非空 +skill-def；总是 agent-def+fs-access；runbook/个人表 +bash-exec+slash-command+subagent-dispatch）', async () => {
    const spec = await parsePackage(fixturePackageDir())
    expect(spec.requires.capabilities).toEqual(
      expect.arrayContaining(['agent-def', 'fs-access', 'skill-def', 'bash-exec', 'slash-command', 'subagent-dispatch']),
    )
  })

  it('包缺失 AGENTS.md → 一等安装期错误 INSTALL_MISSING_FILE', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'wb-spec-bad-'))
    await expect(parsePackage(bad)).rejects.toMatchObject({
      code: 'INSTALL_MISSING_FILE',
      phase: 'parse',
    })
  })
})
