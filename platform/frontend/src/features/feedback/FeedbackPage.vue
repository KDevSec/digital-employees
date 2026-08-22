<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiClientError } from '../../api'
import Pagination from '../../shell/Pagination.vue'
import { useSessionStore } from '../../stores/session'
import type { FeedbackCreate, PaginatedResponse, ProblemFeedback } from '../../types'

const { t } = useI18n()
const session = useSessionStore()
const isAdmin = computed(() => session.can('feedback.manage'))

const loading = ref(false)
const toast = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
let toastTimer: number | undefined
function showToast(kind: 'success' | 'error', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'success' ? 2200 : 4000)
}

const offset = ref(0)
const limit = ref(20)
const total = ref(0)
const rows = ref<ProblemFeedback[]>([])

const showSubmit = ref(false)
const submitting = ref(false)
const form = reactive<FeedbackCreate>({ title: '', category: 'BUG', description: '', priority: 'MEDIUM', contact: '' })

const filters = reactive({ status: '', category: '', priority: '', q: '' })

const editing = ref<ProblemFeedback | null>(null)
const saving = ref(false)
const editForm = reactive({ status: '', priority: '', category: '', admin_reply: '' })

const detail = ref<ProblemFeedback | null>(null)

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
const CATEGORY_ICON: Record<string, string> = { BUG: '🐛', SUGGESTION: '💡', QUESTION: '❓', OTHER: '•' }
function statusClass(status: string) {
  return { success: status === 'RESOLVED', warning: status === 'IN_PROGRESS', 'badge-muted': status === 'CLOSED' }
}
function priorityClass(p: string) {
  return { danger: p === 'HIGH', warning: p === 'MEDIUM' }
}

function resetAndLoad() {
  offset.value = 0
  load()
}

async function load() {
  loading.value = true
  try {
    let path: string
    if (isAdmin.value) {
      const qs = [`offset=${offset.value}`, `limit=${limit.value}`]
      if (filters.status) qs.push(`status=${filters.status}`)
      if (filters.category) qs.push(`category=${filters.category}`)
      if (filters.priority) qs.push(`priority=${filters.priority}`)
      if (filters.q) qs.push(`q=${encodeURIComponent(filters.q)}`)
      path = `/api/v1/admin/feedback?${qs.join('&')}`
    } else {
      path = `/api/v1/feedback/mine?offset=${offset.value}&limit=${limit.value}`
    }
    const data = await api<PaginatedResponse<ProblemFeedback>>(path)
    rows.value = data.items
    total.value = data.total
  } catch (reason) {
    showToast('error', reason instanceof ApiClientError ? reason.message : t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function openSubmit() {
  form.title = ''
  form.description = ''
  form.contact = ''
  form.category = 'BUG'
  form.priority = 'MEDIUM'
  showSubmit.value = true
}

async function submit() {
  submitting.value = true
  try {
    await api('/api/v1/feedback', { method: 'POST', body: JSON.stringify(form) })
    showToast('success', t('feedback.submitted'))
    showSubmit.value = false
    await load()
  } catch (reason) {
    showToast('error', reason instanceof ApiClientError ? reason.message : t('errors.saveFailed'))
  } finally {
    submitting.value = false
  }
}

async function openDetail(item: ProblemFeedback) {
  try {
    detail.value = await api<ProblemFeedback>(`/api/v1/feedback/${item.id}`)
  } catch (reason) {
    showToast('error', reason instanceof ApiClientError ? reason.message : t('errors.loadFailed'))
  }
}

function startEdit(item: ProblemFeedback) {
  editing.value = item
  editForm.status = item.status
  editForm.priority = item.priority
  editForm.category = item.category
  editForm.admin_reply = item.admin_reply ?? ''
}

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  try {
    await api(`/api/v1/admin/feedback/${editing.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: editForm.status,
        priority: editForm.priority,
        category: editForm.category,
        admin_reply: editForm.admin_reply,
      }),
    })
    showToast('success', t('feedback.saved'))
    editing.value = null
    await load()
  } catch (reason) {
    showToast('error', reason instanceof ApiClientError ? reason.message : t('errors.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <Transition name="toast">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>
    </Transition>

    <div class="page-heading">
      <div>
        <p class="eyebrow">Feedback</p>
        <h1>{{ isAdmin ? t('feedback.adminFeedback') : t('feedback.myFeedback') }}</h1>
        <p>{{ t('feedback.subtitle') }}</p>
      </div>
      <button class="button primary" @click="openSubmit">{{ t('feedback.submit') }}</button>
    </div>

    <div v-if="isAdmin" class="panel toolbar filters">
      <label class="sel">{{ t('feedback.status') }}
        <select v-model="filters.status" class="field" @change="resetAndLoad">
          <option value="">{{ t('feedback.all') }}</option>
          <option value="OPEN">{{ t('feedback.statuses.OPEN') }}</option>
          <option value="IN_PROGRESS">{{ t('feedback.statuses.IN_PROGRESS') }}</option>
          <option value="RESOLVED">{{ t('feedback.statuses.RESOLVED') }}</option>
          <option value="CLOSED">{{ t('feedback.statuses.CLOSED') }}</option>
        </select>
      </label>
      <label class="sel">{{ t('feedback.category') }}
        <select v-model="filters.category" class="field" @change="resetAndLoad">
          <option value="">{{ t('feedback.all') }}</option>
          <option value="BUG">{{ t('feedback.categories.BUG') }}</option>
          <option value="SUGGESTION">{{ t('feedback.categories.SUGGESTION') }}</option>
          <option value="QUESTION">{{ t('feedback.categories.QUESTION') }}</option>
          <option value="OTHER">{{ t('feedback.categories.OTHER') }}</option>
        </select>
      </label>
      <label class="sel">{{ t('feedback.priority') }}
        <select v-model="filters.priority" class="field" @change="resetAndLoad">
          <option value="">{{ t('feedback.all') }}</option>
          <option value="LOW">{{ t('feedback.priorities.LOW') }}</option>
          <option value="MEDIUM">{{ t('feedback.priorities.MEDIUM') }}</option>
          <option value="HIGH">{{ t('feedback.priorities.HIGH') }}</option>
        </select>
      </label>
      <label class="sel search">{{ t('feedback.search') }}<input v-model="filters.q" class="field" @keyup.enter="resetAndLoad" /></label>
      <button class="button" @click="resetAndLoad">{{ t('feedback.all') }}</button>
    </div>

    <p v-if="loading" class="empty">{{ t('feedback.loading') }}</p>

    <div v-else-if="!rows.length" class="panel empty-card">
      <p class="empty">{{ t('feedback.noData') }}</p>
      <button class="button primary" @click="openSubmit">{{ t('feedback.submit') }}</button>
    </div>

    <div v-else-if="isAdmin" class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('feedback.titleField') }}</th>
            <th>{{ t('feedback.category') }}</th>
            <th>{{ t('feedback.priority') }}</th>
            <th>{{ t('feedback.status') }}</th>
            <th>{{ t('feedback.submitter') }}</th>
            <th>{{ t('feedback.createdAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td class="truncate">{{ item.title }}</td>
            <td><span class="tag">{{ CATEGORY_ICON[item.category] }} {{ t(`feedback.categories.${item.category}`) }}</span></td>
            <td><span class="badge" :class="priorityClass(item.priority)">{{ t(`feedback.priorities.${item.priority}`) }}</span></td>
            <td><span class="badge" :class="statusClass(item.status)">{{ t(`feedback.statuses.${item.status}`) }}</span></td>
            <td>{{ item.submitter_display_name }}</td>
            <td>{{ fmt(item.created_at) }}</td>
            <td><button class="button primary" @click="startEdit(item)">{{ t('feedback.edit') }}</button></td>
          </tr>
        </tbody>
      </table>
      <Pagination :total="total" :offset="offset" :limit="limit" @update:offset="offset = $event; load()" @update:limit="limit = $event; load()" />
    </div>

    <div v-else class="card-list">
      <article v-for="item in rows" :key="item.id" class="panel fb-card" @click="openDetail(item)">
        <div class="fb-head">
          <span class="badge" :class="statusClass(item.status)">{{ t(`feedback.statuses.${item.status}`) }}</span>
          <span class="tag">{{ CATEGORY_ICON[item.category] }} {{ t(`feedback.categories.${item.category}`) }}</span>
          <span class="badge" :class="priorityClass(item.priority)">{{ t(`feedback.priorities.${item.priority}`) }}</span>
        </div>
        <h3 class="fb-title">{{ item.title }}</h3>
        <p class="fb-desc">{{ item.description }}</p>
        <p v-if="item.admin_reply" class="fb-reply">💬 {{ item.admin_reply }}</p>
        <p class="fb-meta">{{ fmt(item.created_at) }}</p>
      </article>
    </div>

    <Transition name="fade">
      <div v-if="showSubmit" class="overlay" @click.self="showSubmit = false">
        <div class="panel dialog">
          <header class="dialog-head">
            <h2>{{ t('feedback.submit') }}</h2>
            <button class="icon-btn" @click="showSubmit = false">✕</button>
          </header>
          <form class="dialog-body" @submit.prevent="submit">
            <label>{{ t('feedback.titleField') }}<input v-model="form.title" class="field" required maxlength="200" /></label>
            <div class="grid-2">
              <label>{{ t('feedback.category') }}
                <select v-model="form.category" class="field">
                  <option value="BUG">{{ t('feedback.categories.BUG') }}</option>
                  <option value="SUGGESTION">{{ t('feedback.categories.SUGGESTION') }}</option>
                  <option value="QUESTION">{{ t('feedback.categories.QUESTION') }}</option>
                  <option value="OTHER">{{ t('feedback.categories.OTHER') }}</option>
                </select>
              </label>
              <label>{{ t('feedback.priority') }}
                <select v-model="form.priority" class="field">
                  <option value="LOW">{{ t('feedback.priorities.LOW') }}</option>
                  <option value="MEDIUM">{{ t('feedback.priorities.MEDIUM') }}</option>
                  <option value="HIGH">{{ t('feedback.priorities.HIGH') }}</option>
                </select>
              </label>
            </div>
            <label>{{ t('feedback.description') }}<textarea v-model="form.description" class="field" required rows="4" maxlength="5000"></textarea>
              <small class="counter">{{ form.description.length }}/5000</small>
            </label>
            <label>{{ t('feedback.contact') }}<input v-model="form.contact" class="field" maxlength="200" /></label>
            <footer class="dialog-foot actions">
              <button type="button" class="button" @click="showSubmit = false">{{ t('feedback.cancel') }}</button>
              <button type="submit" class="button primary" :disabled="submitting">{{ t('feedback.submit') }}</button>
            </footer>
          </form>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="editing" class="overlay drawer-overlay" @click.self="editing = null">
        <aside class="panel drawer">
          <header class="dialog-head">
            <h2>{{ t('feedback.edit') }}</h2>
            <button class="icon-btn" @click="editing = null">✕</button>
          </header>
          <div class="dialog-body">
            <p class="fb-title truncate">{{ editing.title }}</p>
            <label>{{ t('feedback.status') }}
              <select v-model="editForm.status" class="field">
                <option value="OPEN">{{ t('feedback.statuses.OPEN') }}</option>
                <option value="IN_PROGRESS">{{ t('feedback.statuses.IN_PROGRESS') }}</option>
                <option value="RESOLVED">{{ t('feedback.statuses.RESOLVED') }}</option>
                <option value="CLOSED">{{ t('feedback.statuses.CLOSED') }}</option>
              </select>
            </label>
            <label>{{ t('feedback.priority') }}
              <select v-model="editForm.priority" class="field">
                <option value="LOW">{{ t('feedback.priorities.LOW') }}</option>
                <option value="MEDIUM">{{ t('feedback.priorities.MEDIUM') }}</option>
                <option value="HIGH">{{ t('feedback.priorities.HIGH') }}</option>
              </select>
            </label>
            <label>{{ t('feedback.category') }}
              <select v-model="editForm.category" class="field">
                <option value="BUG">{{ t('feedback.categories.BUG') }}</option>
                <option value="SUGGESTION">{{ t('feedback.categories.SUGGESTION') }}</option>
                <option value="QUESTION">{{ t('feedback.categories.QUESTION') }}</option>
                <option value="OTHER">{{ t('feedback.categories.OTHER') }}</option>
              </select>
            </label>
            <label>{{ t('feedback.adminReply') }}<textarea v-model="editForm.admin_reply" class="field" rows="4" maxlength="5000"></textarea></label>
          </div>
          <footer class="dialog-foot actions">
            <button class="button" @click="editing = null">{{ t('feedback.cancel') }}</button>
            <button class="button primary" :disabled="saving" @click="saveEdit">{{ t('feedback.save') }}</button>
          </footer>
        </aside>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="detail" class="overlay" @click.self="detail = null">
        <div class="panel dialog detail-card">
          <header class="dialog-head">
            <h2>{{ t('feedback.detail') }}</h2>
            <button class="icon-btn" @click="detail = null">✕</button>
          </header>
          <div class="dialog-body">
            <div class="fb-head">
              <span class="badge" :class="statusClass(detail.status)">{{ t(`feedback.statuses.${detail.status}`) }}</span>
              <span class="tag">{{ CATEGORY_ICON[detail.category] }} {{ t(`feedback.categories.${detail.category}`) }}</span>
              <span class="badge" :class="priorityClass(detail.priority)">{{ t(`feedback.priorities.${detail.priority}`) }}</span>
            </div>
            <h3 class="fb-title">{{ detail.title }}</h3>
            <p class="fb-desc">{{ detail.description }}</p>
            <div v-if="detail.admin_reply" class="reply-block">
              <small>{{ t('feedback.adminReply') }}</small>
              <p>{{ detail.admin_reply }}</p>
            </div>
            <p class="fb-meta">{{ t('feedback.createdAt') }}: {{ fmt(detail.created_at) }}</p>
          </div>
          <footer class="dialog-foot"><button class="button" @click="detail = null">{{ t('feedback.cancel') }}</button></footer>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.toast { position: fixed; top: 84px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 10px 18px; border-radius: 10px; font-weight: 700; box-shadow: 0 12px 40px rgba(18, 60, 53, .18); }
.toast.success { background: #dcf5ec; color: #08775b; }
.toast.error { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }

.filters .sel { display: inline-flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; color: var(--muted); }
.filters .sel.search { flex: 1 1 220px; }
.filters .sel .field { width: 100%; min-width: 120px; }

.empty-card { display: flex; flex-direction: column; align-items: center; gap: 14px; }

.card-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.fb-card { cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }
.fb-card:hover { transform: translateY(-2px); box-shadow: 0 22px 56px rgba(18, 60, 53, .12); }
.fb-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.fb-title { margin: 0 0 6px; font-size: 16px; font-weight: 800; color: #1f2b29; }
.fb-desc { margin: 0 0 10px; color: var(--muted); font-size: 13px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fb-reply { margin: 0 0 10px; padding: 8px 10px; background: #f3faf6; border-left: 3px solid var(--mint); border-radius: 6px; font-size: 13px; color: #1f4a40; }
.fb-meta { margin: 0; font-size: 12px; color: var(--muted); }

.tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: #eef2f1; border-radius: 99px; font-size: 11px; font-weight: 800; color: #32413e; }
.badge-muted { background: #f1f3f2 !important; color: #9aa6a3 !important; }

.overlay { position: fixed; inset: 0; background: rgba(18, 60, 53, .42); display: flex; align-items: center; justify-content: center; z-index: 50; }
.drawer-overlay { justify-content: flex-end; }
.dialog { width: min(560px, 92vw); max-height: 88vh; display: flex; flex-direction: column; }
.drawer { width: min(440px, 92vw); height: 100vh; max-height: 100vh; display: flex; flex-direction: column; animation: slide-in-right .22s ease; border-radius: 0; }
.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.dialog-head h2 { margin: 0; font-size: 16px; }
.icon-btn { border: 0; background: transparent; font-size: 16px; cursor: pointer; color: var(--muted); padding: 4px 8px; border-radius: 8px; }
.icon-btn:hover { background: #eef2f1; }
.dialog-body { padding: 18px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.dialog-body label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; font-weight: 700; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.counter { color: var(--muted); font-size: 11px; text-align: right; }
.dialog-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; }

.reply-block { margin: 6px 0 10px; padding: 12px 14px; background: #f3faf6; border-left: 4px solid var(--mint); border-radius: 8px; }
.reply-block small { color: var(--mint); font-weight: 800; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.reply-block p { margin: 4px 0 0; color: #1f4a40; line-height: 1.6; }

.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@keyframes slide-in-right { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

@media (max-width: 720px) {
  .grid-2 { grid-template-columns: 1fr; }
  .drawer { width: 100vw; }
}
</style>
