import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectTerminalMetadata, isPrivateIPv4, primaryMacAddress } from '../src/app/platform-access/terminal-metadata'

describe('collectTerminalMetadata（024 精简）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('只采集主机名与主 MAC，不再上报 IP 列表/OS 版本/安装路径', () => {
    const meta = collectTerminalMetadata()
    expect(typeof meta.hostname).toBe('string')
    expect(meta.hostname.length).toBeGreaterThan(0)
    // 形状仅两键
    expect(Object.keys(meta).sort()).toEqual(['hostname', 'mac_address'])
    expect(meta).not.toHaveProperty('internal_ips')
    expect(meta).not.toHaveProperty('os_version')
    expect(meta).not.toHaveProperty('install_path')
  })

  it('主 MAC 为单值字符串或 null（多网卡只取第一块活动内网网卡）', () => {
    const mac = primaryMacAddress()
    expect(mac === null || typeof mac === 'string').toBe(true)
    if (mac !== null) {
      expect(mac).not.toBe('00:00:00:00:00:00')
      expect(mac.split(':')).toHaveLength(6)
    }
  })

  it('isPrivateIPv4 识别私网段并排除回环/公网', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true)
    expect(isPrivateIPv4('192.168.1.5')).toBe(true)
    expect(isPrivateIPv4('172.20.3.4')).toBe(true)
    expect(isPrivateIPv4('127.0.0.1')).toBe(true)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
  })
})
