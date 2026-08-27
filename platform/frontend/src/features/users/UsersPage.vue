<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import OrgScopeTree from './OrgScopeTree.vue'
import type { PaginatedResponse, PrincipalAuthorizations, PrincipalDetail, ScopeOptions } from '../../types'

interface Principal {
  id: string
  username: string
  display_name: string
  email: string | null
  domain_id: string
  domain_name: string
  department_id: string | null
  department_name: string
  team_id: string | null
  org_path: string
  status: string
  roles: string[]
}

interface OrgContext {
  domain: { id: string; name: string } | null
  department: { id: string; name: string } | null
  team: { id: string; name: string } | null
  primary_org: { id: string; name: string } | null
  primary_org_path: { id: string; name: string; org_type: string }[]
  collaborations: { org_id: string; name: string; membership_type: string }[]
}

const { t } = useI18n()
const principals = ref<Principal[]>([])
const message = ref('')
const loading = ref(true)
const syncing = ref(false)

const search = ref('')
const filterOrgIds = ref<string[]>([])
const showOrgFilter = ref(false)
const filterStatus = ref('')
const filterRole = ref('')

const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const selectedIds = ref<Set<string>>(new Set())

const selectedUser = ref<Principal | null>(null)
const showDetail = ref(false)
const orgContext = ref<OrgContext | null>(null)
const detailLoading = ref(false)
const principalAuth = ref<PrincipalAuthorizations | null>(null)
const authLoading = ref(false)
const syncedAt = ref<string | null>(null)

const scopeOptions = ref<ScopeOptions | null>(null)
const showPermPanel = ref(false)
const permUser = ref<Principal | null>(null)
const permMessage = ref('')

const builtinRoleOptions = [
  { role_code: 'SYSTEM_ADMIN', label: t('app.roles.SYSTEM_ADMIN') },
  { role_code: 'PLATFORM_ADMIN', label: t('app.roles.PLATFORM_ADMIN') },
  { role_code: 'DEPARTMENT_ADMIN', label: t('app.roles.DEPARTMENT_ADMIN') },
  { role_code: 'SECURITY_ADMIN', label: t('app.roles.SECURITY_ADMIN') },
  { role_code: 'AUDIT_ADMIN', label: t('app.roles.AUDIT_ADMIN') },
  { role_code: 'EMPLOYEE', label: t('app.roles.EMPLOYEE') },
]
const customRoleOptions = computed(() => scopeOptions.value?.custom_roles ?? [])
const orgNodeOptions = computed(() => scopeOptions.value?.org_nodes ?? [])

const customRoleNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(customRoleOptions.value.map((r) => [r.id, r.name])),
)
const orgNodeNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(orgNodeOptions.value.map((o) => [o.id, o.name])),
)
const orgNodeDomainMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const n of orgNodeOptions.value) {
    map[n.id] = n.domain_id
  }
  return map
})

const permForm = reactive({
  kind: 'builtin' as 'builtin' | 'custom',
  role_code: 'EMPLOYEE',
  role_id: '',
  domain_id: '',
  department_ids: [] as string[],
  scope_org_id: '',
  scope_include_descendants: true,
})

const rolesNeedingScope = new Set(['DEPARTMENT_ADMIN', 'SECURITY_ADMIN', 'AUDIT_ADMIN'])


async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('offset', String(offset.value))
    params.set('limit', String(limit.value))
    if (search.value) params.set('query', search.value)
    if (filterStatus.value) params.set('status', filterStatus.value)
    if (filterRole.value) params.set('role_code', filterRole.value)
    for (const orgId of filterOrgIds.value) params.append('department_ids', orgId)
    const paged = await api<PaginatedResponse<Principal>>(`/api/v1/iam/principals?${params}`)
    principals.value = paged.items
    total.value = paged.total
    selectedIds.value = new Set()
  } catch {
    message.value = t('errors.loadDataFailed')
  } finally {
    loading.value = false
  }
}

function onPageChange() {
  selectedIds.value = new Set()
  load()
}

function onSearch() {
  offset.value = 0
  load()
}

function onFilterChange() {
  offset.value = 0
  load()
}

function toggleFilterOrg(id: string) {
  const idx = filterOrgIds.value.indexOf(id)
  if (idx >= 0) filterOrgIds.value.splice(idx, 1)
  else filterOrgIds.value.push(id)
}

async function ensureScopeOptions() {
  if (scopeOptions.value === null) {
    scopeOptions.value = await api<ScopeOptions>('/api/v1/authorization/scope-options')
  }
  if (!permForm.domain_id && scopeOptions.value.domains.length > 0) permForm.domain_id = scopeOptions.value.domains[0].id
  if (!permForm.role_id && scopeOptions.value.custom_roles.length > 0) permForm.role_id = scopeOptions.value.custom_roles[0].id
  if (!permForm.scope_org_id && scopeOptions.value.org_nodes.length > 0) permForm.scope_org_id = scopeOptions.value.org_nodes[0].id
}

async function showOrgFilterPanel() {
  showOrgFilter.value = !showOrgFilter.value
  if (showOrgFilter.value) await ensureScopeOptions()
}

function applyOrgFilter() {
  showOrgFilter.value = false
  offset.value = 0
  load()
}

function clearOrgFilter() {
  filterOrgIds.value = []
  showOrgFilter.value = false
  offset.value = 0
  load()
}

function openDetail(user: Principal) {
  selectedUser.value = user
  showDetail.value = true
  orgContext.value = null
  principalAuth.value = null
  syncedAt.value = null
  loadDetail(user.id)
}

async function loadDetail(principalId: string) {
  detailLoading.value = true
  try {
    const detail = await api<PrincipalDetail>(`/api/v1/principals/${principalId}/detail`)
    orgContext.value = detail.org_context
    principalAuth.value = detail.authorizations
    syncedAt.value = detail.identity.synced_at
  } catch {
    orgContext.value = null
    principalAuth.value = null
  } finally {
    detailLoading.value = false
  }
}

async function loadAuthorizations(principalId: string) {
  authLoading.value = true
  try {
    principalAuth.value = await api<PrincipalAuthorizations>(`/api/v1/principals/${principalId}/authorizations`)
  } catch {
    principalAuth.value = null
  } finally {
    authLoading.value = false
  }
}

function closeDetail() {
  showDetail.value = false
  selectedUser.value = null
  orgContext.value = null
  principalAuth.value = null
  syncedAt.value = null
}

async function openPermPanel(user: Principal) {
  permUser.value = user
  permMessage.value = ''
  showPermPanel.value = true
  permForm.kind = 'builtin'
  permForm.role_code = 'EMPLOYEE'
  permForm.department_ids = []
  permForm.scope_include_descendants = true
  if (!permForm.domain_id) permForm.domain_id = user.domain_id
  principalAuth.value = null
  await Promise.all([ensureScopeOptions(), loadAuthorizations(user.id)])
  const existing = principalAuth.value?.fixed_assignments.find((a) => a.role_code === 'DEPARTMENT_ADMIN')
  if (existing) {
    permForm.role_code = 'DEPARTMENT_ADMIN'
    permForm.department_ids = [...existing.department_ids]
  }
}

function toggleDepartment(id: string) {
  const idx = permForm.department_ids.indexOf(id)
  if (idx >= 0) permForm.department_ids.splice(idx, 1)
  else permForm.department_ids.push(id)
}

async function submitAssignment() {
  if (!permUser.value) return
  permMessage.value = ''
  try {
    if (permForm.kind === 'builtin') {
      const role = permForm.role_code
      let scope_type = 'GLOBAL'
      let domain_id: string | null = null
      let department_ids: string[] = []
      if (role === 'EMPLOYEE') {
        scope_type = 'SELF'
      } else if (rolesNeedingScope.has(role)) {
        const selectedDomains = new Set(
          permForm.department_ids.map((id) => orgNodeDomainMap.value[id]).filter(Boolean),
        )
        if (selectedDomains.size > 1) {
          permMessage.value = t('users.perm.crossDomain')
          return
        }
        domain_id = selectedDomains.size === 1 ? [...selectedDomains][0] : permForm.domain_id
        if (permForm.department_ids.length > 0) {
          scope_type = 'DEPARTMENT_SET'
          department_ids = permForm.department_ids
        } else {
          scope_type = 'ALL_DEPARTMENTS'
        }
      }
      await api('/api/v1/role-assignments', {
        method: 'POST',
        body: JSON.stringify({
          principal_id: permUser.value.id,
          role_code: role,
          scope_type,
          domain_id,
          department_ids,
        }),
      })
    } else {
      if (!permForm.role_id || !permForm.scope_org_id) {
        permMessage.value = t('users.perm.needRoleAndScope')
        return
      }
      await api('/api/v1/role-grants', {
        method: 'POST',
        body: JSON.stringify({
          role_id: permForm.role_id,
          subject_type: 'PRINCIPAL',
          subject_id: permUser.value.id,
          subject_include_descendants: false,
          scope_org_id: permForm.scope_org_id,
          scope_include_descendants: permForm.scope_include_descendants,
        }),
      })
    }
    permMessage.value = t('users.perm.assigned')
    await loadAuthorizations(permUser.value.id)
    await load()
  } catch (e: any) {
    permMessage.value = e.message || t('errors.saveFailed')
  }
}

async function revokeFixed(id: string) {
  permMessage.value = ''
  try {
    await api(`/api/v1/role-assignments/${id}`, { method: 'DELETE' })
    if (permUser.value) await loadAuthorizations(permUser.value.id)
    await load()
  } catch (e: any) {
    permMessage.value = e.message || t('errors.saveFailed')
  }
}

async function revokeScoped(id: string) {
  permMessage.value = ''
  try {
    await api(`/api/v1/role-grants/${id}`, { method: 'DELETE' })
    if (permUser.value) await loadAuthorizations(permUser.value.id)
  } catch (e: any) {
    permMessage.value = e.message || t('errors.saveFailed')
  }
}

async function toggleStatus(user: Principal) {
  const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const action = newStatus === 'ACTIVE' ? t('users.enable') : t('users.disable')
  if (!confirm(t('users.confirmToggle', { action, name: user.display_name }))) return
  try {
    await api(`/api/v1/principals/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) })
    user.status = newStatus
    message.value = t('users.toggled', { action, name: user.display_name })
    if (selectedUser.value?.id === user.id) selectedUser.value.status = newStatus
  } catch (e: any) {
    message.value = e.message || t('errors.saveFailed')
  }
}

function toggleSelect(user: Principal) {
  const next = new Set(selectedIds.value)
  if (next.has(user.id)) next.delete(user.id)
  else next.add(user.id)
  selectedIds.value = next
}

function toggleSelectAll() {
  if (selectedIds.value.size === principals.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(principals.value.map((p) => p.id))
  }
}

async function batchToggleStatus(status: string) {
  const action = status === 'ACTIVE' ? t('users.enable') : t('users.disable')
  if (!confirm(t('users.confirmToggle', { action, name: `${selectedIds.value.size} users` }))) return
  try {
    const result = await api<{ total: number; succeeded: number; failed: { id: string; reason: string }[] }>(
      '/api/v1/principals/batch-status',
      { method: 'POST', body: JSON.stringify({ principal_ids: [...selectedIds.value], status }) },
    )
    message.value = t('users.toggled', { action, name: `${result.succeeded}/${result.total}` })
    if (result.failed.length > 0) {
      message.value += ` (${result.failed.length} failed)`
    }
    await load()
  } catch (e: any) {
    message.value = e.message || t('errors.saveFailed')
  }
}

async function syncFromIAM() {
  syncing.value = true
  message.value = ''
  try {
    const result = await api<{
      principals_synced: number
      principals_disabled: number
      org_nodes_synced: number
      status: string
    }>('/api/v1/iam/sync', { method: 'POST' })
    message.value = t('users.syncDone', {
      principals: result.principals_synced,
      orgs: result.org_nodes_synced,
    })
    if (result.principals_disabled > 0) {
      message.value += ' ' + t('users.syncDisabled', { disabled: result.principals_disabled })
    }
    await load()
  } catch (e: any) {
    message.value = e?.error?.message || e?.message || t('users.syncFailed')
  } finally {
    syncing.value = false
  }
}

function statusBadge(status: string) {
  if (status === 'ACTIVE') return 'success'
  if (status === 'DISABLED') return 'danger'
  return ''
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return t('users.active')
  if (status === 'DISABLED') return t('users.disabled')
  return status
}

function roleLabel(role: string) {
  return t(`app.roles.${role}`, role)
}

onMounted(async () => {
  await load()
})
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <p class="eyebrow">User & Organization</p>
        <h1>{{ t('users.title') }}</h1>
        <p>{{ t('users.subtitle') }}</p>
      </div>
      <div class="actions">
        <button class="button primary" type="button" :disabled="syncing" @click="syncFromIAM">
          {{ syncing ? t('users.syncing') : t('users.syncFromIAM') }}
        </button>
      </div>
    </div>

    <p v-if="message" class="notice" :class="{ error: message.includes('失败') || message.includes('failed') }">{{ message }}</p>

    <div class="toolbar">
      <input v-model="search" class="field" style="max-width: 260px" :placeholder="t('users.searchPlaceholder')" @keyup.enter="offset = 0; load()">
      <div class="org-filter">
        <button type="button" class="field org-filter-btn" @click="showOrgFilterPanel">
          {{ t('users.orgFilter') }}<span v-if="filterOrgIds.length" class="org-filter-count">{{ filterOrgIds.length }}</span>
        </button>
        <div v-if="showOrgFilter" class="org-filter-popover">
          <div class="org-filter-head">{{ t('users.orgFilterHint') }}</div>
          <OrgScopeTree
            :nodes="orgNodeOptions"
            :parent-id="null"
            :selected-ids="filterOrgIds"
            @toggle="toggleFilterOrg"
          />
          <div class="org-filter-actions">
            <button type="button" class="button small" @click="clearOrgFilter">{{ t('users.clearFilter') }}</button>
            <button type="button" class="button small primary" @click="applyOrgFilter">{{ t('users.applyFilter') }}</button>
          </div>
        </div>
      </div>
      <select v-model="filterStatus" class="field" style="max-width: 140px" @change="onFilterChange">
        <option value="">{{ t('users.allStatuses') }}</option>
        <option value="ACTIVE">{{ t('users.active') }}</option>
        <option value="DISABLED">{{ t('users.disabled') }}</option>
      </select>
      <select v-model="filterRole" class="field" style="max-width: 180px" @change="onFilterChange">
        <option value="">{{ t('users.allRoles') }}</option>
        <option v-for="r in builtinRoleOptions" :key="r.role_code" :value="r.role_code">{{ r.label }}</option>
      </select>
    </div>

    <div v-if="selectedIds.size > 0" class="batch-bar">
      <span>{{ t('users.selectedCount', { count: selectedIds.size }) }}</span>
      <button class="button small danger" type="button" @click="batchToggleStatus('DISABLED')">{{ t('users.disable') }}</button>
      <button class="button small" type="button" @click="batchToggleStatus('ACTIVE')">{{ t('users.enable') }}</button>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th style="width:40px"><input type="checkbox" :checked="selectedIds.size === principals.length && principals.length > 0" @change="toggleSelectAll"></th>
            <th>{{ t('users.colUser') }}</th>
            <th>{{ t('users.colUsername') }}</th>
            <th>{{ t('users.colDepartment') }}</th>
            <th>{{ t('users.colRoles') }}</th>
            <th>{{ t('users.colStatus') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="7" class="empty">{{ t('users.loading') }}</td></tr>
          <tr v-else-if="principals.length === 0"><td colspan="7" class="empty">{{ t('users.noData') }}</td></tr>
          <tr v-for="user in principals" :key="user.id">
            <td><input type="checkbox" :checked="selectedIds.has(user.id)" @change="toggleSelect(user)"></td>
            <td style="cursor: pointer" @click="openDetail(user)">
              <div style="display: flex; align-items: center; gap: 9px">
                <span class="avatar">{{ user.display_name.charAt(0) }}</span>
                <div><b>{{ user.display_name }}</b><br><small>{{ user.email || '-' }}</small></div>
              </div>
            </td>
            <td><code style="font-size: 12px">{{ user.username }}</code></td>
            <td>{{ user.org_path || user.department_name || '-' }}</td>
            <td>
              <span v-if="user.roles.length === 0" style="color: var(--muted)">-</span>
              <span v-for="role in user.roles" :key="role" class="badge" style="margin-right: 4px">{{ roleLabel(role) }}</span>
            </td>
            <td><span class="badge" :class="statusBadge(user.status)">{{ statusLabel(user.status) }}</span></td>
            <td><button class="button small danger" type="button" @click.stop="toggleStatus(user)">{{ user.status === 'ACTIVE' ? t('users.disable') : t('users.enable') }}</button></td>
          </tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; onPageChange()" @update:limit="limit = $event; onPageChange()" />
    </div>

    <div v-if="showDetail" class="drawer-overlay" @click.self="closeDetail">
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow" style="margin: 0">{{ t('users.detail.title') }}</p>
            <h2 style="margin: 4px 0 0">{{ selectedUser?.display_name }}</h2>
          </div>
          <button class="x-btn" type="button" @click="closeDetail">&times;</button>
        </div>
        <div v-if="selectedUser" class="drawer-body">
          <dl class="detail-list">
            <dt>{{ t('users.detail.username') }}</dt><dd>{{ selectedUser.username }}</dd>
            <dt>{{ t('users.detail.email') }}</dt><dd>{{ selectedUser.email || '-' }}</dd>
            <dt>{{ t('users.detail.domain') }}</dt><dd>{{ selectedUser.domain_name }}</dd>
            <dt>{{ t('users.detail.department') }}</dt><dd>{{ selectedUser.org_path || selectedUser.department_name || '-' }}</dd>
            <dt>{{ t('users.detail.status') }}</dt><dd><span class="badge" :class="statusBadge(selectedUser.status)">{{ statusLabel(selectedUser.status) }}</span></dd>
            <dt>{{ t('users.detail.syncedAt') }}</dt><dd>{{ syncedAt || '-' }}</dd>
          </dl>

          <h3 class="section-title">{{ t('users.org.title') }}</h3>
          <p v-if="detailLoading" class="hint">{{ t('users.loading') }}</p>
          <dl v-else-if="orgContext" class="detail-list">
            <dt>{{ t('users.org.structure') }}</dt>
            <dd>
              <span class="org-path">
                <span v-if="orgContext.domain">{{ orgContext.domain.name }}</span>
                <span v-if="orgContext.department" class="sep">/</span>
                <span v-if="orgContext.department">{{ orgContext.department.name }}</span>
                <span v-if="orgContext.team" class="sep">/</span>
                <span v-if="orgContext.team">{{ orgContext.team.name }}</span>
              </span>
            </dd>
            <dt v-if="orgContext.primary_org">{{ t('users.org.primaryOrg') }}</dt>
            <dd v-if="orgContext.primary_org">
              <span v-for="(node, i) in orgContext.primary_org_path" :key="node.id">
                <span v-if="i > 0" class="sep">/</span>{{ node.name }}
              </span>
            </dd>
            <dt v-if="orgContext.collaborations.length">{{ t('users.org.collaborations') }}</dt>
            <dd v-if="orgContext.collaborations.length">
              <span v-for="c in orgContext.collaborations" :key="c.org_id" class="badge" style="margin-right: 4px">{{ c.name }}</span>
            </dd>
          </dl>
          <p v-else class="hint">{{ t('users.org.unavailable') }}</p>

          <h3 class="section-title">{{ t('users.perm.current') }}</h3>
          <p v-if="detailLoading" class="hint">{{ t('users.loading') }}</p>
          <dl v-else-if="principalAuth && (principalAuth.fixed_assignments.length || principalAuth.scoped_grants.length)" class="detail-list">
            <dt>{{ t('users.colRoles') }}</dt>
            <dd>
              <span v-for="a in principalAuth.fixed_assignments" :key="a.id" class="badge" style="margin-right: 4px">{{ roleLabel(a.role_code) }}</span>
              <span v-for="g in principalAuth.scoped_grants" :key="g.id" class="badge" style="margin-right: 4px">{{ g.role_name }}</span>
            </dd>
          </dl>
          <p v-else class="hint">{{ t('users.perm.none') }}</p>

          <div class="drawer-actions">
            <button class="button primary" type="button" @click="openPermPanel(selectedUser)">{{ t('users.perm.setTitle') }}</button>
            <button class="button danger" type="button" @click="toggleStatus(selectedUser)">{{ selectedUser.status === 'ACTIVE' ? t('users.detail.disableUser') : t('users.detail.enableUser') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showPermPanel" class="modal-overlay" @click.self="showPermPanel = false">
      <div class="modal">
        <div class="modal-head">
          <h2>{{ t('users.perm.title') }} - {{ permUser?.display_name }}</h2>
          <button class="x-btn" type="button" @click="showPermPanel = false">&times;</button>
        </div>
        <div class="modal-body">
          <p v-if="permMessage" class="notice" :class="{ error: permMessage.includes('失败') || permMessage.includes('need') }">{{ permMessage }}</p>

          <h3 class="section-title">{{ t('users.perm.current') }}</h3>
          <p v-if="authLoading" class="hint">{{ t('users.loading') }}</p>
          <ul class="role-list" v-else-if="principalAuth">
            <li v-for="a in principalAuth.fixed_assignments" :key="a.id">
              <span class="badge">{{ roleLabel(a.role_code) }}</span>
              <small class="scope">{{ a.scope_type }}</small>
              <button class="button small danger" type="button" @click="revokeFixed(a.id)">{{ t('users.perm.revoke') }}</button>
            </li>
            <li v-for="g in principalAuth.scoped_grants" :key="g.id">
              <span class="badge">{{ g.role_name }}</span>
              <small class="scope">{{ g.scope_org_name }}{{ g.scope_include_descendants ? ' +' + t('users.perm.descendants') : '' }}</small>
              <button class="button small danger" type="button" @click="revokeScoped(g.id)">{{ t('users.perm.revoke') }}</button>
            </li>
            <li v-if="principalAuth.fixed_assignments.length === 0 && principalAuth.scoped_grants.length === 0" class="hint">{{ t('users.perm.none') }}</li>
          </ul>

          <h3 class="section-title">{{ t('users.perm.assignTitle') }}</h3>
          <form class="assign-form" @submit.prevent="submitAssignment">
              <label>{{ t('users.perm.role') }}
                <select v-model="permForm.role_code" class="field">
                  <option v-for="r in builtinRoleOptions" :key="r.role_code" :value="r.role_code">{{ r.label }}</option>
                </select>
              </label>
              <div v-if="rolesNeedingScope.has(permForm.role_code)" class="scope-block">
                <div class="scope-tree-box">
                  <div class="scope-tree-head">{{ t('users.perm.scopeTree') }}</div>
                  <p v-if="orgNodeOptions.length === 0" class="hint">{{ t('users.perm.noDepartments') }}</p>
                  <OrgScopeTree
                    v-else
                    :nodes="orgNodeOptions"
                    :parent-id="null"
                    :selected-ids="permForm.department_ids"
                    :disabled-types="['DOMAIN']"
                    @toggle="toggleDepartment"
                  />
                </div>
                <p class="hint">{{ t('users.perm.scopeHint') }}</p>
              </div>
            <div class="form-actions">
              <button class="button primary" type="submit">{{ t('users.perm.assign') }}</button>
              <button class="button" type="button" @click="showPermPanel = false">{{ t('users.perm.cancel') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; align-items: center; }
.org-filter { position: relative; display: inline-block; }
.org-filter-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; max-width: 200px; justify-content: space-between; }
.org-filter-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--forest, #1f6f5c); color: #fff; font-size: 11px; font-weight: 700; }
.org-filter-popover { position: absolute; top: calc(100% + 4px); left: 0; z-index: 30; width: 280px; max-height: 340px; overflow: auto; background: #fff; border: 1px solid var(--border, #d9dfeb); border-radius: 8px; box-shadow: 0 12px 30px rgba(12, 40, 35, .18); padding: 10px; }
.org-filter-head { font-size: 12px; color: var(--muted, #888); margin-bottom: 6px; }
.org-filter-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line, #eee); }
.batch-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #e8f0fe; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
.avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: #eaf2ef; color: var(--forest); font-weight: 850; }
.notice { background: #e8f6ee; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.notice.error { background: #fde8e8; color: #c44; }
.section-title { margin: 18px 0 8px; font-size: 14px; font-weight: 700; color: var(--forest); }
.hint { font-size: 12px; color: var(--muted); }
.org-path .sep { color: var(--muted); margin: 0 4px; }

.drawer-overlay { position: fixed; inset: 0; background: rgba(17, 41, 36, .47); z-index: 40; display: flex; justify-content: flex-end; }
.drawer { width: min(540px, 100%); height: 100%; background: #fff; box-shadow: -25px 0 70px rgba(12, 40, 35, .3); overflow: auto; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 18px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: #fff; z-index: 2; }
.drawer-body { padding: 18px 20px; }
.drawer-actions { margin-top: 20px; display: flex; gap: 8px; }
.x-btn { border: 0; background: transparent; font-size: 24px; color: var(--muted); cursor: pointer; }
.detail-list { display: grid; grid-template-columns: 90px 1fr; gap: 12px 14px; }
.detail-list dt { color: var(--muted); font-size: 12px; font-weight: 700; }
.detail-list dd { margin: 0; word-break: break-all; }

.modal-overlay { position: fixed; inset: 0; background: rgba(17, 41, 36, .47); z-index: 50; display: flex; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: min(620px, 95%); max-height: 88vh; overflow: auto; box-shadow: 0 20px 60px rgba(12, 40, 35, .3); }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: #fff; z-index: 2; }
.modal-head h2 { margin: 0; font-size: 1.1rem; }
.modal-body { padding: 20px; }

.role-list { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 6px; }
.role-list li { display: flex; align-items: center; gap: 8px; }
.role-list .scope { color: var(--muted); font-size: 12px; flex: 1; }

.kind-toggle { display: flex; gap: 8px; margin-bottom: 14px; }
.assign-form { display: flex; flex-direction: column; gap: 12px; }
.assign-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
.check-row { flex-direction: row !important; align-items: center; gap: 6px; }
.scope-block { display: flex; flex-direction: column; gap: 10px; }
.scope-tree-box { border: 1px solid var(--border, #d9dfeb); border-radius: 8px; padding: 10px; max-height: 320px; overflow: auto; }
.scope-tree-head { font-weight: 600; font-size: 13px; margin-bottom: 6px; color: var(--forest); }
.form-actions { display: flex; gap: 8px; }
.small { padding: 4px 8px; font-size: 12px; }
</style>
