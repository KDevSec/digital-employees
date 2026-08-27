// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Placeholder from '../src/views/Placeholder.vue'
import { basesRoutes } from '../src/router/routes/bases'

/**
 * Placeholder 参数化占位页（I0-5 T3，D-6）：占位域路由以 props 传标题/说明文案，
 * 组件只做展示（风格简朴）。路由级渲染由 guard-integration 端到端覆盖。
 * 域替换史：employees → L1 Task 17 EmployeesView（花名册）；kanban → L5 看板线 KanbanView；
 * 至此仅剩 bases 一域占位（待 L2 线填充真视图后本文件退役）。
 */

interface PlaceholderProps {
  title: string
  description?: string
}

function placeholderProps(record: (typeof basesRoutes)[number]): PlaceholderProps {
  expect(typeof record.props, '占位路由应以 props 对象传标题/说明文案').toBe('object')
  return record.props as PlaceholderProps
}

describe('Placeholder 参数化占位页（I0-5 T3，D-6）', () => {
  it('bases 域：路由以 props 传标题/说明，组件只做展示', () => {
    const props = placeholderProps(basesRoutes[0])
    expect(props.title).toBe('底座与环境')
    const wrapper = mount(Placeholder, { props })
    expect(wrapper.text()).toContain(props.title)
    expect(wrapper.text()).toContain(props.description ?? '')
  })
})
