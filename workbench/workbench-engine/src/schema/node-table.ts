/**
 * node-table 契约真源（I0-4 / T1）——设计文档 2026-08-26-协同编排-design.md §6。
 * 两层校验：zod .strict() 结构层（未知键报错，严格 schema 纪律）+
 * 跨字段层（1.0 load_node_table 语义全部前置到加载时，运行期不再兜底）。
 * human_gate 布尔严格——1.0 YAML1.1 on/off 字符串坑的回归锚。
 */
import { z } from 'zod'

export type NodeKind = 'action' | 'gate' | 'terminal'

export interface FlowNode {
  id: string; name?: string; kind: NodeKind; stage?: string;
  emp?: string; prompt?: string; model_tier?: string; human_gate?: boolean;
  gate?: string; next: string[]
}

export interface GateSpec {
  kind: 'review' | 'acceptance' | 'decision';
  reviewer: string; on_pass?: string; on_reflow?: string; branches?: Record<string, string>;
  covers?: string[]
}

export interface NodeTable {
  flow: string; display_name?: string; version?: number;
  max_retries: number; terminal_fail: string | null; delivery_node?: string;
  nodes: FlowNode[]; gate_specs: Record<string, GateSpec>
}

export type TableError = { ok: false; error: string; detail?: string }

/** schema/跨字段校验失败——message 含字段定位（[node-table] 前缀 + 节点/spec 定位） */
export class EngineSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineSchemaError'
  }
}

const flowNodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    kind: z.enum(['action', 'gate', 'terminal']),
    stage: z.string().optional(),
    emp: z.string().optional(),
    prompt: z.string().optional(),
    model_tier: z.string().optional(),
    /** 布尔严格：缺省归一 false，字符串 'on'/'off' 报类型错 */
    human_gate: z.boolean().default(false),
    gate: z.string().optional(),
    next: z.array(z.string()),
  })
  .strict()

const coversField = z.array(z.string()).optional()

/** 各 kind 必填分支：review/acceptance 需 on_pass+on_reflow；decision 需 branches 非空 record */
const gateSpecSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('review'),
      reviewer: z.string().min(1),
      on_pass: z.string(),
      on_reflow: z.string(),
      covers: coversField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('acceptance'),
      reviewer: z.string().min(1),
      on_pass: z.string(),
      on_reflow: z.string(),
      covers: coversField,
    })
    .strict(),
  z
    .object({
      kind: z.literal('decision'),
      reviewer: z.string().min(1),
      branches: z
        .record(z.string())
        .refine((b) => Object.keys(b).length > 0, { message: 'branches 不能为空' }),
      covers: coversField,
    })
    .strict(),
])

const nodeTableSchema = z
  .object({
    flow: z.string().min(1),
    display_name: z.string().optional(),
    version: z.number().int().optional(),
    /** 非负整数，缺省 3 */
    max_retries: z.number().int().nonnegative().default(3),
    /** 缺省 null（无兜底终止节点时不强制） */
    terminal_fail: z.string().nullable().default(null),
    delivery_node: z.string().optional(),
    nodes: z.array(flowNodeSchema).min(1, 'nodes 不能为空数组'),
    gate_specs: z.record(gateSpecSchema).default({}),
  })
  .strict()

/** zod issues → 带路径定位的单行错误串 */
function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((iss) => {
      const at = iss.path.length > 0 ? iss.path.join('.') : '(root)'
      return `${at}: ${iss.message}`
    })
    .join('；')
}

/**
 * 解析并校验 node-table（两层：zod 结构层 + 跨字段层），非法抛 EngineSchemaError。
 * 归一：max_retries 缺省 3 / terminal_fail 缺省 null / human_gate 缺省 false / version 缺省不填。
 */
export function parseNodeTable(raw: unknown): NodeTable {
  let parsed: z.infer<typeof nodeTableSchema>
  try {
    parsed = nodeTableSchema.parse(raw)
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EngineSchemaError(`[node-table] schema 校验失败——${formatZodIssues(err)}`)
    }
    throw err
  }

  // —— 跨字段层（1.0 load_node_table 语义前置）——
  const ids = new Set<string>()
  for (const n of parsed.nodes) {
    if (ids.has(n.id)) throw new EngineSchemaError(`[node-table] node '${n.id}': id 重复`)
    ids.add(n.id)
  }
  for (const n of parsed.nodes) {
    for (const to of n.next) {
      if (!ids.has(to)) {
        throw new EngineSchemaError(`[node-table] node '${n.id}': next 指向不存在节点 '${to}'`)
      }
    }
    if (n.kind === 'terminal' && n.next.length > 0) {
      throw new EngineSchemaError(
        `[node-table] node '${n.id}': terminal 节点 next 必须为空数组（got [${n.next.join(', ')}]）`,
      )
    }
    if (n.kind === 'gate') {
      if (!n.gate) throw new EngineSchemaError(`[node-table] node '${n.id}': gate 节点缺少 gate 字段`)
      if (!Object.hasOwn(parsed.gate_specs, n.gate)) {
        throw new EngineSchemaError(`[node-table] node '${n.id}': gate '${n.gate}' 不在 gate_specs`)
      }
    }
  }
  for (const [gid, spec] of Object.entries(parsed.gate_specs)) {
    const targets: Array<[string, string | undefined]> = []
    if (spec.kind === 'decision') {
      for (const [b, to] of Object.entries(spec.branches)) targets.push([`branches['${b}']`, to])
    } else {
      targets.push(['on_pass', spec.on_pass], ['on_reflow', spec.on_reflow])
    }
    for (const [key, to] of targets) {
      if (to !== undefined && !ids.has(to)) {
        throw new EngineSchemaError(`[node-table] gate_spec '${gid}': ${key} 指向不存在节点 '${to}'`)
      }
    }
  }
  if (parsed.terminal_fail !== null) {
    const tf = parsed.terminal_fail
    const tfNode = parsed.nodes.find((n) => n.id === tf)
    if (!tfNode) throw new EngineSchemaError(`[node-table] terminal_fail '${tf}': 节点不存在`)
    if (tfNode.kind !== 'terminal') {
      throw new EngineSchemaError(
        `[node-table] terminal_fail '${tf}': 不是 terminal 节点（kind='${tfNode.kind}'）`,
      )
    }
  }

  return parsed
}
