/**
 * 平台版本（025）：公开存活探针 /health/live 同源返回 { status, version }。
 * 不走鉴权 api()（无 401 重定向语义）；失败归一 null，页面不渲染版本行。
 */
export async function fetchPlatformVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('/health/live', { signal: controller.signal, credentials: 'omit' })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { version?: unknown } | null
    return typeof data?.version === 'string' && data.version.trim() ? data.version : null
  } catch {
    return null
  }
}
