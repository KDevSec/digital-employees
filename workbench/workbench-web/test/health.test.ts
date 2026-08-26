import { describe, expect, it } from 'vitest'
import { interpretHealth, versionLine, versionLineGated } from '../src/api/health'

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

  it('自家 app 但 status 非 ok（如 degraded）→ 不可用', () => {
    expect(interpretHealth({ app: 'workbench', status: 'degraded' })).toEqual({
      ok: false,
      badge: '服务不可用',
      badgeClass: 'down',
    })
  })
})

describe('versionLine（版本行文案，纯函数）', () => {
  it('有版本与端口 → v<version> · 端口 <port>', () => {
    expect(versionLine({ version: '0.1.0', port: 19980 })).toBe('v0.1.0 · 端口 19980')
  })

  it('无信息（null）→ 版本未知', () => {
    expect(versionLine(null)).toBe('版本未知')
  })

  it('有版本无端口（缺省分支）→ 只显示 v<version>', () => {
    expect(versionLine({ version: '1.0', port: undefined })).toBe('v1.0')
  })

  it('空版本号 → 版本未知', () => {
    expect(versionLine({ version: '' })).toBe('版本未知')
  })
})

describe('versionLineGated（版本行健康门控：仅健康态展示版本，防外国占用者的 version 误显示）', () => {
  it('健康态（自家 app + ok）→ 正常版本行', () => {
    expect(versionLineGated({ app: 'workbench', status: 'ok', version: '0.1.0' }, 19980)).toBe('v0.1.0 · 端口 19980')
  })

  it('非自家 app（带 version 也不显示）→ 版本未知', () => {
    expect(versionLineGated({ app: 'other-app', status: 'ok', version: '9.9.9' }, 19980)).toBe('版本未知')
  })

  it('fetch 失败 null → 版本未知', () => {
    expect(versionLineGated(null, 19980)).toBe('版本未知')
  })
})
