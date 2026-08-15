<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api } from '../../api'

interface Principal { id: string; display_name: string; username: string; domain_id: string; department_id?: string }
interface Domain { id: string; name: string }
interface Department { id: string; name: string }
interface Assignment { id: string; principal_id: string; role_code: string; scope_type: string; domain_id?: string; department_ids: string[] }

const principals = ref<Principal[]>([]), domains = ref<Domain[]>([]), departments = ref<Department[]>([]), assignments = ref<Assignment[]>([])
const form = reactive({ principal_id: '', role_code: 'EMPLOYEE', scope_type: 'SELF', domain_id: '', department_ids: [] as string[] })
async function load() { [principals.value, domains.value, assignments.value] = await Promise.all([api('/api/v1/iam/principals'), api('/api/v1/iam/domains'), api('/api/v1/role-assignments')]); if (!form.principal_id) form.principal_id = principals.value[0]?.id ?? '' }
watch(() => form.role_code, (role) => { if (['SYSTEM_ADMIN', 'PLATFORM_ADMIN'].includes(role)) form.scope_type = 'GLOBAL'; else if (role === 'EMPLOYEE') form.scope_type = 'SELF'; else form.scope_type = 'DEPARTMENT_SET' })
watch(() => form.domain_id, async (id) => { departments.value = id ? await api(`/api/v1/iam/domains/${id}/departments`) : []; form.department_ids = [] })
async function create() { await api('/api/v1/role-assignments', { method: 'POST', body: JSON.stringify(form) }); await load() }
async function revoke(id: string) { await api(`/api/v1/role-assignments/${id}`, { method: 'DELETE' }); await load() }
onMounted(load)
</script>

<template><section><div class="page-heading"><div><p class="eyebrow">Authorization</p><h1>权限配置</h1><p>仅绑定六种固定角色和冻结的数据范围。</p></div></div>
  <form class="panel form-grid" @submit.prevent="create"><label for="principal">人员<select id="principal" v-model="form.principal_id" class="field"><option v-for="item in principals" :key="item.id" :value="item.id">{{ item.display_name }} ({{ item.username }})</option></select></label><label for="role">角色<select id="role" v-model="form.role_code" class="field"><option v-for="role in ['SYSTEM_ADMIN','PLATFORM_ADMIN','DEPARTMENT_ADMIN','SECURITY_ADMIN','AUDIT_ADMIN','EMPLOYEE']" :key="role">{{ role }}</option></select></label><label v-if="!['SYSTEM_ADMIN','PLATFORM_ADMIN','EMPLOYEE'].includes(form.role_code)" for="scope-type">范围<select id="scope-type" v-model="form.scope_type" class="field"><option value="DEPARTMENT_SET">指定部门</option><option value="ALL_DEPARTMENTS">域内全部部门</option></select></label><label v-if="!['SYSTEM_ADMIN','PLATFORM_ADMIN','EMPLOYEE'].includes(form.role_code)" for="domain">域<select id="domain" v-model="form.domain_id" class="field" required><option value="">请选择</option><option v-for="item in domains" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label v-if="form.scope_type === 'DEPARTMENT_SET'" for="departments">部门<select id="departments" v-model="form.department_ids" class="field" multiple required><option v-for="item in departments" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><button class="button primary" type="submit">授予角色</button></form>
  <div class="panel table-wrap"><table><thead><tr><th>人员</th><th>角色</th><th>范围</th><th>部门</th><th></th></tr></thead><tbody><tr v-for="item in assignments" :key="item.id"><td>{{ principals.find((p) => p.id === item.principal_id)?.display_name || item.principal_id }}</td><td>{{ item.role_code }}</td><td>{{ item.scope_type }} {{ item.domain_id || '' }}</td><td>{{ item.department_ids.join(', ') || '-' }}</td><td><button class="button danger" @click="revoke(item.id)">撤销</button></td></tr></tbody></table></div></section></template>
