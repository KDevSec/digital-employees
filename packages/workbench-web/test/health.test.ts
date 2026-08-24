import { describe, expect, it } from 'vitest'
import { interpretHealth, versionLine } from '../src/api/health'

describe('interpretHealth（healthz JSON → 徽章状态映射，纯函数）', () => {
  it('自家 app 且 status=ok → 运行中', () => {
    expect(interpretHealth({ app: 'workbench', status: 'ok' })).toEqual({
      ok: true,
      badge: '运行中',
      badgeClass: 'ok',
    })
  })

  it('fetch 失败/超时归一 null → 服务不可用（红徽章）', () => {
    expect(interpretHealth(null)).toEqual({
      ok: false,
      badge: '服务不可用',
      badgeClass: 'down',
    })
  })

  it('非自家 app（端口被他物占用）→ ok:false', () => {
    const r = interpretHealth({ app: 'other-app', status: 'ok' })
    expect(r.ok).toBe(false)
    expect(r.badgeClass).toBe('down')
  })
})

describe('versionLine（版本行文案，纯函数）', () => {
  it('有版本与端口 → v<version> · 端口 <port>', () => {
    expect(versionLine({ version: '0.1.0', port: 19980 })).toBe('v0.1.0 · 端口 19980')
  })

  it('无信息（null）→ 版本未知', () => {
    expect(versionLine(null)).toBe('版本未知')
  })
})
