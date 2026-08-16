<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { api } from '../../api'

interface Permission { code: string; description: string; risk_level: string; delegable: boolean }
interface Role { id: string; domain_id: string; code: string; name: string; description?: string; permission_codes: string[]; status: string }
interface OrgNode { id: string; domain_id: string; name: string }
interface Principal { id: string; display_name: string; username: string }
interface Grant { id: string; role_id: string; subject_type: string; subject_id: string; subject_include_descendants: boolean; scope_org_id: string; scope_include_descendants: boolean }

const permissions = ref<Permission[]>([])
const roles = ref<Role[]>([])
const organizations = ref<OrgNode[]>([])
const principals = ref<Principal[]>([])
const grants = ref<Grant[]>([])
const roleForm = reactive({ domain_id: '', code: '', name: '', description: '', permission_codes: [] as string[] })
const grantForm = reactive({ role_id: '', subject_type: 'PRINCIPAL', subject_id: '', subject_include_descendants: false, scope_org_id: '', scope_include_descendants: false })
const message = ref('')

async function load() {
  [permissions.value, roles.value, organizations.value, principals.value, grants.value] = await Promise.all([
    api('/api/v1/permissions'),
    api('/api/v1/roles'),
    api('/api/v1/org-nodes/tree'),
    api('/api/v1/iam/principals'),
    api('/api/v1/role-grants'),
  ])
  if (!roleForm.domain_id) roleForm.domain_id = organizations.value[0]?.domain_id ?? ''
  if (!grantForm.role_id) grantForm.role_id = roles.value[0]?.id ?? ''
  if (!grantForm.scope_org_id) grantForm.scope_org_id = organizations.value[0]?.id ?? ''
}

async function createRole() {
  await api('/api/v1/roles', { method: 'POST', body: JSON.stringify(roleForm) })
  Object.assign(roleForm, { code: '', name: '', description: '', permission_codes: [] })
  message.value = '自定义角色已创建'
  await load()
}

async function createGrant() {
  await api('/api/v1/role-grants', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(grantForm),
  })
  message.value = '组织范围授权已生效'
  await load()
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading"><div><p class="eyebrow">Authorization</p><h1>权限配置</h1><p>系统定义权限点，管理员组合自定义角色并绑定组织范围。</p></div></div>
    <p v-if="message" class="notice">{{ message }}</p>

    <form class="panel form-grid" @submit.prevent="createRole">
      <h2>自定义角色</h2>
      <label>公司域<input v-model="roleForm.domain_id" class="field" required></label>
      <label>角色编码<input v-model="roleForm.code" class="field" required></label>
      <label>角色名称<input v-model="roleForm.name" class="field" required></label>
      <label>说明<input v-model="roleForm.description" class="field"></label>
      <fieldset><legend>权限点</legend><label v-for="permission in permissions" :key="permission.code" class="permission-option"><input v-model="roleForm.permission_codes" type="checkbox" :value="permission.code"> <code>{{ permission.code }}</code> · {{ permission.description }} · {{ permission.risk_level }}<span v-if="!permission.delegable"> · 不可委派</span></label></fieldset>
      <button class="button primary" type="submit">创建角色</button>
    </form>

    <form class="panel form-grid" @submit.prevent="createGrant">
      <h2>授权范围</h2>
      <label>角色<select v-model="grantForm.role_id" class="field" required><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
      <label>授权对象类型<select v-model="grantForm.subject_type" class="field"><option value="PRINCIPAL">人员</option><option value="ORGANIZATION">组织成员</option></select></label>
      <label v-if="grantForm.subject_type === 'PRINCIPAL'">人员<select v-model="grantForm.subject_id" class="field" required><option v-for="person in principals" :key="person.id" :value="person.id">{{ person.display_name }} ({{ person.username }})</option></select></label>
      <label v-else>组织<select v-model="grantForm.subject_id" class="field" required><option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option></select></label>
      <label v-if="grantForm.subject_type === 'ORGANIZATION'"><input v-model="grantForm.subject_include_descendants" type="checkbox"> 包含全部下级组织成员</label>
      <label>资源组织范围<select v-model="grantForm.scope_org_id" class="field" required><option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option></select></label>
      <label><input v-model="grantForm.scope_include_descendants" type="checkbox"> 资源范围包含全部下级</label>
      <button class="button primary" type="submit">授予角色</button>
    </form>

    <div class="panel table-wrap"><h2>有效授权</h2><table><thead><tr><th>角色</th><th>对象</th><th>授权范围</th></tr></thead><tbody><tr v-for="grant in grants" :key="grant.id"><td>{{ roles.find((item) => item.id === grant.role_id)?.name ?? grant.role_id }}</td><td>{{ grant.subject_type }} · {{ grant.subject_id }}<span v-if="grant.subject_include_descendants">（含下级成员）</span></td><td>{{ organizations.find((item) => item.id === grant.scope_org_id)?.name ?? grant.scope_org_id }}<span v-if="grant.scope_include_descendants">（含下级资源）</span></td></tr></tbody></table></div>
  </section>
</template>

<style scoped>
fieldset { border: 1px solid #d9dfeb; border-radius: 8px; padding: 12px; }
.permission-option { display: block; margin: 8px 0; }
.notice { background: #e8f6ee; border-radius: 8px; padding: 10px 14px; }
</style>
