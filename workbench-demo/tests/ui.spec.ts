import { describe, expect, it } from 'vitest'

import { workbenchHtml } from '../src/ui.js'

describe('workbenchHtml', () => {
  it('renders login and approval gate copy', () => {
    const html = workbenchHtml('http://platform.test')
    expect(html).toContain('企业账号登录')
    expect(html).toContain('接入申请')
    expect(html).toContain('审批通过并完成本机激活后')
  })
})
