// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import Placeholder from '../src/views/Placeholder.vue'
import { basesRoutes } from '../src/router/routes/bases'
import { employeesRoutes } from '../src/router/routes/employees'
import { kanbanRoutes } from '../src/router/routes/kanban'

/**
 * Placeholder 参数化占位页（I0-5 T3，D-6）：三域路由各自以 props 传标题/说明文案，
 * 组件只做展示（风格简朴）。路由级渲染（Layout 嵌套命中三路径后的页面标题）
 * 由 guard-integration 测试端到端覆盖；此处锁定「参数化契约 + 三页文案区分」。
 */

interface PlaceholderProps {
  title: string
  description?: string
}

function placeholderProps(record: RouteRecordRaw): PlaceholderProps {
  expect(typeof record.props, '占位路由应以 props 对象传标题/说明文案').toBe('object')
  return record.props as PlaceholderProps
}

describe('Placeholder 占位页（三域参数化渲染）', () => {
  it('employees 域：渲染「我的员工」标题与「员工列表即将上线」说明', () => {
    const props = placeholderProps(employeesRoutes[0])
    const wrapper = mount(Placeholder, { props })
    expect(props.title).toBe('我的员工')
    expect(wrapper.text()).toContain(props.title)
    expect(wrapper.text()).toContain(props.description ?? '')
  })

  it('bases 域：渲染「底座与环境」标题与「底座探测与安装管理即将上线」说明', () => {
    const props = placeholderProps(basesRoutes[0])
    expect(props.title).toBe('底座与环境')
    const wrapper = mount(Placeholder, { props })
    expect(wrapper.text()).toContain(props.title)
    expect(wrapper.text()).toContain(props.description ?? '')
  })

  it('kanban 域：渲染「任务看板」标题与「任务看板即将上线」说明（L5 前为占位页）', () => {
    const props = placeholderProps(kanbanRoutes[0])
    expect(props.title).toBe('任务看板')
    const wrapper = mount(Placeholder, { props })
    expect(wrapper.text()).toContain(props.title)
    expect(wrapper.text()).toContain(props.description ?? '')
  })

  it('三页文案互异（标题与说明均区分，不共用同一占位文案）', () => {
    const domains = [employeesRoutes, basesRoutes, kanbanRoutes]
    const titles = domains.map((routes) => placeholderProps(routes[0]).title)
    const descriptions = domains.map((routes) => placeholderProps(routes[0]).description ?? '')
    expect(new Set(titles).size).toBe(3)
    expect(new Set(descriptions).size).toBe(3)
  })
})
