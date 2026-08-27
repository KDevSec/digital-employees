/** L2 消费面的员工规格（从员工包解析；字段名对齐 manifest 八类 v0.2，见设计 §2） */

export interface SkillEntryLite { name: string; version: string; source_type: 'template' | 'local' }

export interface ConnectorRef {
  name: string; type: 'stdio' | 'http'
  command?: string; args?: string[]; url?: string; env?: Record<string, string>
}

export interface EmployeeSpec {
  id: string; display: string; version: string
  /** AGENTS.md 全文（身份编译源——identity copy 基线，设计 §5.2） */
  instructions: string
  skills: SkillEntryLite[]
  /** level 落盘；capabilities 按 shared-protocol derive.ts 派生表推导（合入后切真源） */
  requires: { level: 'L0' | 'L1' | 'L2'; capabilities: string[] }
  connectors: ConnectorRef[]
  /** constraints.tier 五档单值（launch effort/model 映射输入） */
  tier: string
  /** 包内 hooks/hooks.json 相对路径（存在时 = adapt merge 源） */
  hooksFile?: string
}

export interface EmployeeSpecParser {
  parse(packageRoot: string): Promise<EmployeeSpec>
}
