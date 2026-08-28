// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import Placeholder from '../src/views/Placeholder.vue'
import { employeesRoutes } from '../src/router/routes/employees'

/**
 * Placeholder 参数化占位页（I0-5 T3，D-6）：占位域路由以 props 传标题/说明文案。
 * L5 看板线已换真页；D-bb01 底座页已换 BasesView。仅剩 employees 域占位（待 L1/L4）。
 */

interface PlaceholderProps {
  title: string
  description?: string
}

function placeholderProps(record: RouteRecordRaw): PlaceholderProps {
  expect(typeof record.props, '占位路由应以 props 对象传标题/说明文案').toBe('object')
  return record.props as PlaceholderProps
}

describe('Placeholder 占位页（employees 域仍占位）', () => {
  it('employees 域：渲染「我的员工」标题与「员工列表即将上线」说明', () => {
    const props = placeholderProps(employeesRoutes[0])
    const wrapper = mount(Placeholder, { props })
    expect(props.title).toBe('我的员工')
    expect(wrapper.text()).toContain(props.title)
    expect(wrapper.text()).toContain(props.description ?? '')
  })
})
