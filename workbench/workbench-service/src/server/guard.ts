/**
 * Host 头白名单守卫（S-12 DNS rebinding 防护，设计 §10.1）。
 * 仅放行 localhost / 127.0.0.1（带或不带端口，大小写不敏感）；违者 403。
 * 纯函数，不做 IO，不 import hono。
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export function isLocalHost(host: string): boolean {
  // host 常见形如 "localhost:19980"；IPv6 字面量 "[::1]:80" 去端口时取最后一个冒号前段
  const bare = host.includes(']') ? host.slice(0, host.lastIndexOf(']') + 1) : host.split(':')[0]
  return LOCAL_HOSTS.has(bare.toLowerCase())
}

export function forbiddenHostResponse(host: string): { status: number; text: string } {
  return { status: 403, text: `Host not allowed: ${host}` }
}
