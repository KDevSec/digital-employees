/**
 * 平台地址配置 API 层（I0-5 T8，设计 D-13~D-18 方案 A）：
 * - fetchPlatformConfig：GET /api/config/platform，沿 api/health.ts 手法——同源相对路径 +
 *   2s 超时 + 失败/非 2xx/形状不对归一 null（外部对象不可信容错）；
 * - savePlatformConfig：PUT /api/config/platform，返回形状沿 api/access.ts 的 ActionResult
 *   先例——失败透传服务端 error.message（service 侧错误形状 {error:{code,message}} 沿 demo
 *   PlatformError 处理器，前端免适配），网络异常归一失败结果不抛出。
 * 消费边界（D-18）：本线只配不消费——登录/enrollment 读该地址属 A-01（G-1 已档）。
 */
import type { ActionResult } from './access'

/** /api/config/platform 的 GET 响应形状 */
export interface PlatformConfig {
  baseUrl: string
  insecureTls: boolean
}

/**
 * 单次平台配置抓取（2s 超时，失败/非 2xx/形状不对归一 null）。
 * 同源相对路径请求（页面由服务自身伺服；dev 由 Vite 代理到 19980/19982）。
 */
export async function fetchPlatformConfig(): Promise<PlatformConfig | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch('/api/config/platform', { signal: controller.signal })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as unknown
    if (typeof data !== 'object' || data === null) return null
    const raw = data as Record<string, unknown>
    // baseUrl 非字符串 → 形状不对整包拒绝（外部对象不可信）；insecureTls 缺省按 false
    if (typeof raw.baseUrl !== 'string') return null
    return { baseUrl: raw.baseUrl, insecureTls: raw.insecureTls === true }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 保存平台地址（PUT /api/config/platform，body { baseUrl }）。
 * 024：TLS 校验开关不再由 UI 暴露（仅配置文件排障后手），前端只提交平台地址。
 * 成功文案「已保存」（区别于动作类「操作成功」——配置语义）；400 等失败透传服务端
 * error.message（INVALID_PLATFORM_URL 等校验消息），无 message 时回退 statusText。
 */
export async function savePlatformConfig(baseUrl: string): Promise<ActionResult> {
  try {
    const res = await fetch('/api/config/platform', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) {
      return { ok: false, message: data.error?.message ?? res.statusText }
    }
    return { ok: true, message: '已保存' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '保存失败' }
  }
}
