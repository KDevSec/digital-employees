<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  total: number
  offset: number
  limit: number
}>()

const emit = defineEmits<{
  (e: 'update:offset', value: number): void
  (e: 'update:limit', value: number): void
}>()

const { t } = useI18n()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)))
const currentPage = computed(() => Math.floor(props.offset / props.limit) + 1)
const pageSizes = [10, 20, 50, 100]

function goTo(page: number) {
  if (page < 1 || page > totalPages.value) return
  emit('update:offset', (page - 1) * props.limit)
}

function changeLimit(e: Event) {
  const value = Number((e.target as HTMLSelectElement).value)
  emit('update:limit', value)
  emit('update:offset', 0)
}

const pages = computed(() => {
  const result: (number | string)[] = []
  const total = totalPages.value
  const current = currentPage.value
  if (total <= 7) {
    for (let i = 1; i <= total; i++) result.push(i)
  } else {
    result.push(1)
    if (current > 3) result.push('...')
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) result.push(i)
    if (current < total - 2) result.push('...')
    result.push(total)
  }
  return result
})
</script>

<template>
  <div class="pagination">
    <span class="pagination-info">{{ t('pagination.showing', { from: props.total === 0 ? 0 : props.offset + 1, to: Math.min(props.offset + props.limit, props.total), total: props.total }) }}</span>
    <div class="pagination-controls">
      <button class="page-btn" :disabled="currentPage <= 1" @click="goTo(currentPage - 1)">{{ t('pagination.prev') }}</button>
      <template v-for="p in pages" :key="p">
        <span v-if="p === '...'" class="page-ellipsis">...</span>
        <button v-else class="page-btn" :class="{ active: p === currentPage }" @click="goTo(p as number)">{{ p }}</button>
      </template>
      <button class="page-btn" :disabled="currentPage >= totalPages" @click="goTo(currentPage + 1)">{{ t('pagination.next') }}</button>
    </div>
    <select class="page-size" :value="limit" @change="changeLimit">
      <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} / {{ t('pagination.page') }}</option>
    </select>
  </div>
</template>

<style scoped>
.pagination { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.pagination-info { font-size: 13px; color: var(--muted); white-space: nowrap; }
.pagination-controls { display: flex; align-items: center; gap: 4px; }
.page-btn { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; color: var(--forest); }
.page-btn:disabled { opacity: .4; cursor: default; }
.page-btn.active { background: var(--forest); color: #fff; border-color: var(--forest); }
.page-ellipsis { padding: 0 4px; color: var(--muted); }
.page-size { font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; }
</style>