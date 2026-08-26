/**
 * events 账本契约（I0-4 / T1）——设计文档 2026-08-26-协同编排-design.md §7.3（六类事件）。
 * engineEventSchema：discriminated union on type，载荷可选键按 type 收窄
 * （strict——携带他类载荷键即报错，收窄即校验）；通用键 seq/ts/trace_id/parent_seq/actor/flow 全类型必有。
 */
import { z } from 'zod'

export type EventType =
  | 'run.created' | 'run.completed' | 'run.aborted'
  | 'transition' | 'gate' | 'dispatch'

export interface EngineEvent {
  seq: number; ts: string; type: EventType; trace_id: string;
  parent_seq: number | null; actor: string; flow: string;
  // 各类载荷（可选键按 type 出现）：
  from?: string; to?: string; reflow?: boolean; forced_fail?: boolean; reason?: string | null;
  status?: string; gate?: string; kind?: string; node?: string; verdict?: string;
  iter?: number; reviewer?: string; issues?: string[]; request_id?: string;
  phase?: 'start' | 'done'; emp?: string; dispatch_id?: string; usage?: Record<string, number>;
  title?: string; workspace?: string; display_name?: string; final_node?: string; duration_s?: number
}

const eventBase = {
  seq: z.number().int(),
  ts: z.string(),
  trace_id: z.string(),
  parent_seq: z.number().int().nullable(),
  actor: z.string(),
  flow: z.string(),
} as const

export const engineEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...eventBase, type: z.literal('transition'),
    from: z.string().optional(), to: z.string().optional(),
    reflow: z.boolean().optional(), forced_fail: z.boolean().optional(),
    reason: z.string().nullable().optional(), status: z.string().optional(),
  }).strict(),
  z.object({
    ...eventBase, type: z.literal('gate'),
    gate: z.string().optional(), kind: z.string().optional(), node: z.string().optional(),
    verdict: z.string().optional(), iter: z.number().int().optional(),
    reviewer: z.string().optional(), issues: z.array(z.string()).optional(),
    request_id: z.string().optional(),
  }).strict(),
  z.object({
    ...eventBase, type: z.literal('dispatch'),
    phase: z.enum(['start', 'done']).optional(), emp: z.string().optional(),
    dispatch_id: z.string().optional(), node: z.string().optional(),
    status: z.string().optional(), usage: z.record(z.number()).optional(),
  }).strict(),
  z.object({
    ...eventBase, type: z.literal('run.created'),
    title: z.string().optional(), workspace: z.string().optional(),
    display_name: z.string().optional(),
  }).strict(),
  z.object({
    ...eventBase, type: z.literal('run.completed'),
    final_node: z.string().optional(), duration_s: z.number().optional(),
  }).strict(),
  z.object({
    ...eventBase, type: z.literal('run.aborted'),
    final_node: z.string().optional(), reason: z.string().nullable().optional(),
  }).strict(),
])
