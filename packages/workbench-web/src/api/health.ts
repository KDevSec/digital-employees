/**
 * healthz 状态映射 + 抓取（Web 壳唯一数据源，设计 §10.2 C-4 契约的消费端）。
 * interpretHealth / versionLine 为纯函数（无 DOM / 无网络，单测覆盖）；
 * fetchHealthz 不硬编码端口——同源相对路径请求，dev 由 Vite 代理到 127.0.0.1:19980。
 */

/** 本工作台的 app 标识（与 service 侧 brand.app 单源对应；跨包无法 import，此处镜像） */
const APP_ID = 'workbench'

/** /healthz JSON（C-4 契约形状，字段全可选——外部对象不可信） */
export interface HealthzJson {
  app?: string
  status?: string
  version?: string
  pid?: number
  uid?: string
  uptime?: number
  dataDir?: string
}

/** 徽章渲染状态（Home.vue 消费） */
export interface HealthBadge {
  ok: boolean
  badge: string
  badgeClass: 'ok' | 'down'
}

/**
 * healthz JSON → 徽章状态。
 * fetch 失败/超时归一为 null；非自家 app（端口被他物占用）或 status 非 ok 均判不可用。
 */
export function interpretHealth(json: HealthzJson | null): HealthBadge {
  if (json && json.app === APP_ID && json.status === 'ok') {
    return { ok: true, badge: '运行中', badgeClass: 'ok' }
  }
  return { ok: false, badge: '服务不可用', badgeClass: 'down' }
}

/** 版本行：`v<version> · 端口 <port>`；无版本信息 → 「版本未知」 */
export function versionLine(info: { version?: string; port?: number } | null): string {
  if (info && typeof info.version === 'string' && info.version.length > 0) {
    const portPart = info.port ? ` · 端口 ${info.port}` : ''
    return `v${info.version}${portPart}`
  }
  return '版本未知'
}

/**
 * 单次 healthz 抓取（2s 超时，失败/非 2xx 归一 null）。
 * 缺省同源请求 `/healthz`（页面由服务自身伺服）；显式传 port 时打 127.0.0.1:<port>。
 */
export async function fetchHealthz(port?: number): Promise<HealthzJson | null> {
  const url = port ? `http://127.0.0.1:${port}/healthz` : '/healthz'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as HealthzJson
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
