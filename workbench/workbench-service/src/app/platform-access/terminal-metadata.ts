/**
 * 终端元数据采集（024 精简）：仅主机名与主网卡 MAC。
 * - hostname：终端名称来源（缺省由调用方回退「终端 xxxx」）。
 * - mac_address：第一块活动内网 IPv4 网卡的 MAC（单值）；多网卡不再上报列表。
 * - IP 不采集——平台以请求对端地址为唯一 IP（防伪造）。
 * 采集失败降级为空，绝不阻断接入/心跳。
 */
import { networkInterfaces, hostname as osHostname } from 'node:os'

export interface TerminalMetadata {
  hostname: string
  mac_address: string | null
}

export function isPrivateIPv4(address: string): boolean {
  if (address.startsWith('127.')) return true
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** 主网卡 MAC：枚举第一块活动内网 IPv4 网卡对应的非零 MAC。 */
export function primaryMacAddress(): string | null {
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const net of entries ?? []) {
        if (net.family !== 'IPv4' || net.internal) continue
        if (!isPrivateIPv4(net.address)) continue
        if (net.mac && net.mac !== '00:00:00:00:00:00') return net.mac
      }
    }
  } catch {
    // 网络枚举失败时返回 null，不阻断流程。
  }
  return null
}

export function collectTerminalMetadata(): TerminalMetadata {
  return {
    hostname: safe(() => osHostname(), ''),
    mac_address: primaryMacAddress(),
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
