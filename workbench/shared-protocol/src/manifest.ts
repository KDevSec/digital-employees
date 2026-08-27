import { z } from 'zod'

// A3 实装前先在此文件内用占位 z.unknown()？——不：
// 本任务先内联一个最小 skillEntry（z.object({name/version/source_type}).passthrough()），
// A3 任务再抽到 skill.ts 并 import（小步可编译）。
const skillEntrySchema = z.object({
  name: z.string(),
  version: z.string(),
  source_type: z.string(),
}).passthrough()

const semver = /^\d+\.\d+\.\d+$/

export const manifestSchema = z.object({
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

export type Manifest = z.infer<typeof manifestSchema>
