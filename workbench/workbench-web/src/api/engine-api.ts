/**
 * 引擎 HTTP 面（L5 看板线 T9；契约真源 = 协同编排设计 §9.3/§9.1）：
 * 看板发起任务（createTask）/查任务（getTask）/表清单（getFlows）/人工闸辅通道（confirmGate）。
 * 同源相对路径（health.ts 同款——页面由 service 伺服，dev 由 Vite 代理）；失败 reject 带
 * Error 不吞错。fixture 运行时实现同一 EngineApi 接口（kanban-fixture-service.ts）。
 */
import type { TableSnapshot } from './engine-table'

/** 发起任务载荷（§9.1 createTask 参数 1:1；表单逐字段映射见 CreateTaskModal） */
export interface CreateTaskPayload {
  mode: 'team' | 'solo'
  /** team 模式：选表 */
  flow?: string
  /** solo 模式：选员工（引擎动态生成单节点表） */
  employee?: string
  workspace: string
  title: string
  input: string
  base?: string
  model?: string
  effort?: string
}

/** 载荷构造（可选项仅在值非空时入载荷——「使用流程阶段内置档位」时 model/effort 传空即省略） */
export function createTaskPayload(p: CreateTaskPayload): CreateTaskPayload {
  const out: CreateTaskPayload = { mode: p.mode, workspace: p.workspace, title: p.title, input: p.input }
  if (p.flow) out.flow = p.flow
  if (p.employee) out.employee = p.employee
  if (p.base) out.base = p.base
  if (p.model) out.model = p.model
  if (p.effort) out.effort = p.effort
  return out
}

/** 任务详情（getTask 响应形状——契约歧义 A/B 的先行口径：表快照与员工映射随任务下发） */
export interface TaskDetail {
  task: { task_id: string; title?: string; flow?: string; workspace?: string }
  table: TableSnapshot
  employees: Record<string, string>
}

export interface FlowSummary {
  flow: string
  display_name: string
}

export interface EngineApi {
  createTask(payload: CreateTaskPayload): Promise<{ task_id: string }>
  getTask(taskId: string): Promise<TaskDetail>
  getFlows(): Promise<FlowSummary[]>
  confirmGate(taskId: string, node: string, verdict: 'approve' | 'reject', note?: string): Promise<{ ok: boolean }>
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new Error(`引擎服务不可达（${url}）：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`引擎接口失败 ${res.status}（${url}）${body ? `：${body.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as T
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const httpEngineApi: EngineApi = {
  createTask: (payload) => post<{ task_id: string }>('/api/engine/tasks', payload),
  getTask: (taskId) => request<TaskDetail>(`/api/engine/tasks/${encodeURIComponent(taskId)}`),
  getFlows: () => request<FlowSummary[]>('/api/engine/flows'),
  confirmGate: (taskId, node, verdict, note) =>
    post<{ ok: boolean }>(`/api/engine/tasks/${encodeURIComponent(taskId)}/confirm-gate`, {
      node,
      verdict,
      ...(note ? { note } : {}),
    }),
}
