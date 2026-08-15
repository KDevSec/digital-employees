<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../../api'
import { useSessionStore } from '../../stores/session'
import type { Workbench } from '../../types'

const session = useSessionStore()
const rows = ref<Workbench[]>([])
const error = ref('')

async function load() { rows.value = await api('/api/v1/workbenches') }
async function revoke(item: Workbench) {
  const reason = window.prompt(`确认撤销“${item.display_name}”？请输入原因：`)
  if (!reason) return
  try {
    await api(`/api/v1/workbenches/${item.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) })
    await load()
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '撤销失败' }
}
onMounted(load)
</script>

<template>
  <section><div class="page-heading"><div><p class="eyebrow">Workbenches</p><h1>工作台</h1><p>列表由服务端按域、部门或本人范围过滤。</p></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="panel table-wrap"><table><thead><tr><th>名称</th><th>所有人</th><th>环境</th><th>版本</th><th>接入</th><th>连接</th><th>最后心跳</th><th></th></tr></thead>
      <tbody><tr v-for="item in rows" :key="item.id"><td><strong>{{ item.display_name }}</strong><small class="mono">{{ item.id }}</small></td><td>{{ item.owner_principal_id }}</td><td>{{ item.reported_os }} / {{ item.reported_arch }}</td><td>{{ item.reported_version }}</td><td><span class="badge" :class="item.status === 'ACTIVE' ? 'success' : 'danger'">{{ item.status }}</span></td><td>{{ item.connection_status }}</td><td>{{ item.last_heartbeat_at ? new Date(item.last_heartbeat_at).toLocaleString() : '尚未心跳' }}</td><td><button v-if="session.can('workbench.revoke') && item.status === 'ACTIVE'" class="button danger" @click="revoke(item)">撤销</button></td></tr>
      <tr v-if="rows.length === 0"><td colspan="8" class="empty">当前范围内没有工作台。</td></tr></tbody></table></div>
  </section>
</template>
