// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import Placeholder from '../src/views/Placeholder.vue'
import { basesRoutes } from '../src/router/routes/bases'
import { employeesRoutes } from '../src/router/routes/employees'

/**
 * Placeholder 参数化占位页（I0-5 T3，D-6）：占位域路由以 props 传标题/说明文案，
 * 组件只做展示（风格简朴）。路由级渲染由 guard-integration 端到端覆盖。
 * L5 看板线（2026-08-27）：kanban 域已替换为真实页面 KanbanView，占位断言摘除，
 * 仅剩 employees/bases 两域（待 L1/L4、L2 线填充）。
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

  it('两页文案互异（标题与说明均区分，不共用同一占位文案）', () => {
    const domains = [employeesRoutes, basesRoutes]
    const titles = domains.map((routes) => placeholderProps(routes[0]).title)
    const descriptions = domains.map((routes) => placeholderProps(routes[0]).description ?? '')
    expect(new Set(titles).size).toBe(2)
    expect(new Set(descriptions).size).toBe(2)
  })
})
