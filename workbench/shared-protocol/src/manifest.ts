import { z } from 'zod'
import { skillEntrySchema } from './skill'

const semver = /^\d+\.\d+\.\d+$/

// 八类 v0.2 全字段基础对象（A1 产物）；A2 在此基础上挂 superRefine 形成完整 manifestSchema。
const manifestObject = z.object({
  // ── 元数据（10 项）──
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  display: z.string().min(1),
  brief: z.string().max(30),
  avatar: z.string().default(''),
  version: z.string().regex(semver),
  upp_version: z.literal('2.1'),
  kind: z.enum(['flow-owner', 'callee']),
  org: z.string().min(1).default('local'),
  operator: z.string().email(),
  requires: z.object({ level: z.enum(['L0', 'L1', 'L2']) }),
  // ── 八件套（1+7）──
  agent: z.object({
    persona: z.object({
      role: z.string(),
      identity: z.string().min(10),
      principles: z.array(z.string()).default([]),
      usage_modes: z.array(z.enum(['裸用', '+方法论', '+流程', '+编排'])).min(1),
    }),
  }),
  skills: z.array(skillEntrySchema).default([]),
  hooks: z.object({
    redlines: z.array(z.object({
      rule_id: z.enum(['no-push-to-main', 'high-risk-via-gate', 'no-devzero-state',
        'no-external-request', 'no-production-access', 'no-db-schema', 'custom']),
      compiled: z.boolean().default(false),
    })).default([]),
  }).default({ redlines: [] }),
  tools: z.object({ deny: z.array(z.string()).default([]) }).default({ deny: [] }),
  commands: z.literal('commands/'),
  knowledge: z.literal('knowledge/'),
  connectors: z.array(z.object({
    name: z.string(),
    type: z.enum(['stdio', 'http']),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().url().optional(),
    env: z.record(z.string()).default({}),
    access: z.enum(['read', 'read-write']).default('read-write'),
  })).default([]),
  custom: z.record(z.unknown()).default({}),
  // ── 管理面（3 段）──
  constraints: z.object({
    tier: z.enum(['评审安全档', '设计档', '探索档', '编码档', '执行档']).default('编码档'),
    token_quota: z.object({
      per_task: z.number().int().positive().optional(),
      monthly: z.number().int().positive().optional(),
    }).optional(),
  }).default({}),
  governance: z.object({
    level: z.enum(['L1', 'L2', 'L3', 'L4']),
    visibility: z.enum(['private', 'team', 'department', 'company']),
    audit: z.enum(['full', 'exceptions-only']).default('exceptions-only'),
  }),
  orchestration: z.object({
    node_table: z.string().regex(/^orchestration\/.+\.node-table\.yml$/),
  }).optional(),
}).strict()

// A2: 跨字段六规则 superRefine
// R1: usage_modes 含 +编排 ⇒ requires.level 必须为 L2、orchestration.node_table 必填
// R2: kind=callee 不得带 orchestration
// R3: skills name 不得重复
// R4: 红线声明一致性属安装期校验，schema 不拒（无 addIssue）
// R5: connectors stdio 必填 command；http 必填 url
// R6: tools.deny 与 connectors 并存属运行时语义，schema 不拒（无 addIssue）
export const manifestSchema = manifestObject.superRefine((m, ctx) => {
  const hasOrch = m.agent.persona.usage_modes.includes('+编排')
  if (hasOrch) {
    if (m.requires.level !== 'L2') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requires', 'level'],
        message: 'usage_modes 含 +编排 时 requires.level 必须为 L2',
      })
    }
    if (!m.orchestration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orchestration'],
        message: 'usage_modes 含 +编排 时 orchestration.node_table 必填',
      })
    }
  }
  if (m.kind === 'callee' && m.orchestration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['orchestration'],
      message: 'kind=callee 不得有 orchestration',
    })
  }
  const names = m.skills.map((s) => s.name)
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['skills'],
      message: `skills name 重复：${dup}`,
    })
  }
  for (const [i, c] of m.connectors.entries()) {
    if (c.type === 'stdio' && !c.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['connectors', i, 'command'],
        message: 'stdio 连接器 command 必填',
      })
    }
    if (c.type === 'http' && !c.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['connectors', i, 'url'],
        message: 'http 连接器 url 必填',
      })
    }
  }
})

export type Manifest = z.infer<typeof manifestSchema>
