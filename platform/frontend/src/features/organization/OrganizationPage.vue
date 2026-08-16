<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { api } from '../../api'

interface OrgNode {
  id: string
  parent_id?: string
  domain_id: string
  org_code: string
  org_type: string
  name: string
  status: string
  version: number
}

interface Principal {
  id: string
  display_name: string
  username: string
  primary_org_id?: string
}

const roots = ref<OrgNode[]>([])
const children = reactive<Record<string, OrgNode[]>>({})
const selected = ref<OrgNode | null>(null)
const principals = ref<Principal[]>([])
const createForm = reactive({ org_code: '', org_type: 'ORG_UNIT', name: '', sort_order: 0 })
const membership = reactive({ principal_id: '', membership_type: 'PRIMARY' })
const message = ref('')

async function loadRoots() {
  roots.value = await api<OrgNode[]>('/api/v1/org-nodes/tree')
  principals.value = await api<Principal[]>('/api/v1/iam/principals')
}

async function selectNode(node: OrgNode) {
  selected.value = await api<OrgNode>(`/api/v1/org-nodes/${node.id}`)
  children[node.id] = await api<OrgNode[]>(`/api/v1/org-nodes/tree?parent_id=${encodeURIComponent(node.id)}`)
  message.value = ''
}

async function createChild() {
  if (!selected.value) return
  const created = await api<OrgNode>('/api/v1/org-nodes', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...createForm, parent_id: selected.value.id }),
  })
  children[selected.value.id] = [...(children[selected.value.id] ?? []), created]
  Object.assign(createForm, { org_code: '', org_type: 'ORG_UNIT', name: '', sort_order: 0 })
  message.value = `已创建 ${created.name}`
}

async function renameNode() {
  if (!selected.value) return
  selected.value = await api<OrgNode>(`/api/v1/org-nodes/${selected.value.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version: selected.value.version, name: selected.value.name }),
  })
  await loadRoots()
  message.value = '组织名称已更新'
}

async function assignMembership() {
  if (!selected.value || !membership.principal_id) return
  const path = membership.membership_type === 'PRIMARY'
    ? `/api/v1/principals/${membership.principal_id}/primary-org`
    : `/api/v1/principals/${membership.principal_id}/collaborations`
  await api(path, {
    method: membership.membership_type === 'PRIMARY' ? 'PUT' : 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ org_id: selected.value.id }),
  })
  message.value = '人员组织关系已更新'
}

onMounted(loadRoots)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><p class="eyebrow">Identity & Organization</p><h1>组织管理</h1><p>组织树来自 Keycloak，业务授权由平台按组织范围计算。</p></div>
    </div>
    <p v-if="message" class="notice">{{ message }}</p>
    <div class="org-layout">
      <aside class="panel org-tree">
        <h2>组织树</h2>
        <ul>
          <li v-for="root in roots" :key="root.id">
            <button class="tree-node" type="button" @click="selectNode(root)">{{ root.name }}</button>
            <ul v-if="children[root.id]">
              <li v-for="child in children[root.id]" :key="child.id">
                <button class="tree-node" type="button" @click="selectNode(child)">{{ child.name }}</button>
              </li>
            </ul>
          </li>
        </ul>
      </aside>
      <div v-if="selected" class="panel form-grid">
        <h2>节点详情</h2>
        <label>稳定 ID<input class="field" :value="selected.id" disabled></label>
        <label>名称<input v-model="selected.name" class="field"></label>
        <label>类型<input class="field" :value="selected.org_type" disabled></label>
        <button class="button" type="button" @click="renameNode">保存名称</button>

        <h2>新增下级组织</h2>
        <label>编码<input v-model="createForm.org_code" class="field"></label>
        <label>名称<input v-model="createForm.name" class="field"></label>
        <label>类型<input v-model="createForm.org_type" class="field"></label>
        <button class="button primary" type="button" @click="createChild">新增</button>

        <h2>加入人员</h2>
        <label>人员<select v-model="membership.principal_id" class="field"><option value="">请选择</option><option v-for="person in principals" :key="person.id" :value="person.id">{{ person.display_name }} ({{ person.username }})</option></select></label>
        <label>关系<select v-model="membership.membership_type" class="field"><option value="PRIMARY">主组织</option><option value="COLLABORATION">协作组织</option></select></label>
        <button class="button primary" type="button" @click="assignMembership">保存人员关系</button>
      </div>
      <div v-else class="panel"><p>选择一个组织节点查看详情。</p></div>
    </div>
  </section>
</template>

<style scoped>
.org-layout { display: grid; grid-template-columns: minmax(240px, 0.8fr) minmax(360px, 1.4fr); gap: 20px; }
.org-tree ul { list-style: none; padding-left: 16px; }
.tree-node { border: 0; background: transparent; cursor: pointer; padding: 8px; text-align: left; width: 100%; }
.tree-node:hover { background: #eef3ff; }
.notice { background: #e8f6ee; border-radius: 8px; padding: 10px 14px; }
@media (max-width: 800px) { .org-layout { grid-template-columns: 1fr; } }
</style>
