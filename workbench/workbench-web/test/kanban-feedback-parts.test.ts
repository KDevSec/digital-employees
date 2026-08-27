// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConnectionBar from '../src/components/kanban/ConnectionBar.vue'

/**
 * ConnectionBar（SSE 连接态条，L5 看板线 T7→v0.2 保留件）：四态文案与配色类——
 * 断线重连的常驻可视化（重连中 amber），对齐 §8 契约的连接语义。
 * （v0.2 注：原同文件的 EventFeedPanel/GatePauseBar 用例已随组件废弃迁移——
 * 评审流水归 gate-feed-panel.test.ts，停靠告警归 alert-panel.test.ts。）
 */

describe('ConnectionBar（SSE 连接态）', () => {
  it.each([
    ['live', '实时连接', 'live'],
    ['reconnecting', '重连中', 'reconnecting'],
    ['connecting', '连接中', 'connecting'],
    ['closed', '已断开', 'closed'],
  ] as const)('%s → 文案 %s + 类 %s', (conn, text, cls) => {
    const w = mount(ConnectionBar, { props: { connection: conn } })
    expect(w.text()).toContain(text)
    expect(w.find('.conn-bar').classes()).toContain(cls)
  })
})
