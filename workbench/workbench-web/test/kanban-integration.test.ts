// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import KanbanView from '../src/views/KanbanView.vue'
import { useKanbanStore } from '../src/stores/kanban'
import { createFixtureRuntime } from '../src/fixtures/kanban-fixture-service'

/**
 * 看板页 ↔ fixture 运行时集成（L5 看板线 T9）：onMounted 建 runtime → store.connect →
 * mock 流事件归并出卡。KanbanView 的 runtime 创建走真实 use-kanban-runtime（vitest 的
 * import.meta.env.DEV=true → fixture 模式，动态 import 同链路）；表加载 watch 经 getTask
 * 落 store.tables。此用例即「fixture 先行」主场景的最小端到端。
 */

describe('KanbanView × fixture runtime 集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mount 接线后 connection 被流接管；演 createTask → 任务卡出（store 归并）', async () => {
    const store = useKanbanStore()
    const w = mount(KanbanView)
    await flushPromises()
    expect(['connecting', 'live']).toContain(store.connection)

    // 直接驱动 fixture api（KanbanView runtime 内部同款）：事件进 store
    const rt = createFixtureRuntime({ intervalMs: 0 })
    const stream = rt.openStream()
    store.connect(stream)
    const { task_id } = await rt.api.createTask({
      mode: 'team',
      flow: 'demo-flow',
      title: '集成演示',
      workspace: 'D:/demo',
      input: 'x',
    })
    rt.controls.drain()
    await flushPromises()
    expect(store.tasks[task_id]).toBeDefined()
    expect(store.tasks[task_id].status).toBe('completed') // happy-path 全量推干
    expect(store.taskList.length).toBeGreaterThan(0)

    // 表加载链路：getTask → setTable（KanbanView watch 或手动同款调用）
    const detail = await rt.api.getTask(task_id)
    store.setTable(task_id, detail.table, detail.employees)
    expect(store.tables[task_id].nodes).toHaveLength(12)

    w.unmount()
  })
})
