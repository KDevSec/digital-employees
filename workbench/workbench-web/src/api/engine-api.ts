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

/** 任务详情（getTask 装配产物——歧义 A 引擎口径：task 经 GET :id、table 经 GET :id/table） */
export interface TaskDetail {
  task: { task_id: string; title?: string; flow?: string; workspace?: string }
  /** 表端点失败/未就绪 → undefined（看板骨架态，事件流照常推进） */
  table?: TableSnapshot
  employees: Record<string, string>
}

/** 静态七员工映射（内置 team 花名册——设计 §4.1；引擎无员工清单面，契约歧义 B/C 先行口径，
 *  L4 registry 查询面就位后替换为真实源） */
export const STATIC_EMPLOYEES: Record<string, string> = {
  'req-clarifier': '需求澄清师',
  'sys-engineer': '系统工程师',
  'dev-engineer': '开发工程师',
  'reviewer-expert': '评审专家',
  'sec-compliance': '安全合规审核员',
  'sec-design': '安全设计审核员',
  'sec-code': '代码安全审核员',
}

export interface FlowSummary {
  flow: string
  /** 引擎清单面现仅返回 file（文件名）；display_name 表内字段未透出——缺省时 UI 以 flow id 兜底显示 */
  display_name?: string
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
  // 任务详情双调用装配（歧义 A 引擎口径）：task 与 table 分立端点，表失败容错为 undefined（骨架态）
  getTask: async (taskId) => {
    const id = encodeURIComponent(taskId)
    const detail = await request<{ ok: boolean; task: TaskDetail['task'] }>(`/api/engine/tasks/${id}`)
    const table = await request<{ ok: boolean; table: TableSnapshot }>(`/api/engine/tasks/${id}/table`)
      .then((r) => r.table)
      .catch(() => undefined)
    return { task: detail.task, table, employees: STATIC_EMPLOYEES }
  },
  // 引擎真实响应 = {ok:true, flows:[{flow,file}]}（routes/engine.ts flowsList）——拆信封取数组
  getFlows: async () => {
    const res = await request<{ ok: boolean; flows: FlowSummary[] }>('/api/engine/flows')
    return Array.isArray(res?.flows) ? res.flows : []
  },
  confirmGate: (taskId, node, verdict, note) =>
    post<{ ok: boolean }>(`/api/engine/tasks/${encodeURIComponent(taskId)}/confirm-gate`, {
      node,
      verdict,
      ...(note ? { note } : {}),
    }),
}
