<script setup lang="ts">
import { computed, ref } from 'vue'

interface OrgNode {
  id: string
  name: string
  domain_id: string
  org_type: string
  parent_id: string | null
}

defineOptions({ name: 'OrgScopeTree' })

const props = defineProps<{
  nodes: OrgNode[]
  parentId: string | null
  selectedIds: string[]
  level?: number
}>()
const emit = defineEmits<{ toggle: [id: string] }>()

const expanded = ref<Set<string>>(new Set())

const children = computed(() =>
  props.nodes
    .filter((n) => (n.parent_id ?? null) === props.parentId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name)),
)

function hasChildren(id: string) {
  return props.nodes.some((n) => (n.parent_id ?? null) === id)
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
</script>

<template>
  <div v-for="node in children" :key="node.id" class="org-scope-node">
    <div class="org-scope-row" :style="{ paddingLeft: (level ?? 0) * 16 + 'px' }">
      <button
        v-if="hasChildren(node.id)"
        type="button"
        class="org-scope-caret"
        :class="{ 'is-open': expanded.has(node.id) }"
        :aria-expanded="expanded.has(node.id)"
        @click="toggleExpand(node.id)"
      >▸</button>
      <span v-else class="org-scope-caret org-scope-caret-leaf"></span>
      <label class="org-scope-check">
        <input
          type="checkbox"
          :checked="selectedIds.includes(node.id)"
          @change="emit('toggle', node.id)"
        />
        <span class="org-scope-name" :class="{ 'org-scope-domain': node.org_type === 'DOMAIN' }">{{ node.name }}</span>
      </label>
    </div>
    <OrgScopeTree
      v-if="expanded.has(node.id)"
      :nodes="nodes"
      :parent-id="node.id"
      :selected-ids="selectedIds"
      :level="(level ?? 0) + 1"
      @toggle="(id: string) => emit('toggle', id)"
    />
  </div>
</template>

<style scoped>
.org-scope-node {
  display: flex;
  flex-direction: column;
}
.org-scope-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
}
.org-scope-caret {
  width: 16px;
  flex: 0 0 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--muted, #888);
  font-size: 12px;
  line-height: 1;
  text-align: center;
  transition: transform 0.12s ease;
}
.org-scope-caret.is-open {
  transform: rotate(90deg);
}
.org-scope-caret-leaf {
  visibility: hidden;
}
.org-scope-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.org-scope-name {
  color: var(--text-secondary, #555);
}
.org-scope-domain {
  font-weight: 700;
  color: var(--forest, #1f6f5c);
}
</style>
