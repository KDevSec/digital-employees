<script setup lang="ts">
import { computed, ref } from 'vue'

import { useWizardStore } from '../../stores/wizard'
import {
  buildManifestFromDraft,
  fieldToStep,
  manifestToYaml,
  useManifestValidation,
} from '../../composables/useManifestValidation'

/**
 * PreviewPanel（L1 员工新建线 Task 15）：
 * - 校验徽章：绿「校验通过」/红「失败 N 项」可点击展开 issue 列表；防抖期间显「校验中…」
 * - issue 列表：每条显示 path+message，点击 emit `jump-to-field {step, field}` → CreateWizard gotoStep
 * - manifest YAML 渲染：js-yaml dump 组装后的 manifest 值，简易 key/value 着色 span（k 类蓝 c 类灰）
 * - 目录树动态显隐：`<id>/` 根行恒在；skills 勾选 → `skills/<name>/SKILL.md` 行；
 *   redlines 有 compiled → `hooks/hooks.json` 行；connectors 非空 → `mcp.json` 行；
 *   orchestration 需要时 → `orchestration/` 行；commands/knowledge 目录行恒在。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」（完成态显式「安装到底座」动作不在本组件）。
 */

const store = useWizardStore()

const { result, pending } = useManifestValidation(() => store.draft)

/** 徽章展开态（issue 列表显隐） */
const badgeOpen = ref(false)

/** 校验通过？/ issue 数 */
const isValid = computed(() => result.value.valid)
const issueCount = computed(() => result.value.issues.length)

/** 切换徽章展开 */
function toggleBadge(): void {
  if (isValid.value) return
  badgeOpen.value = !badgeOpen.value
}

/** issue 点击 → emit jump-to-field {step, field} */
const emit = defineEmits<{
  (e: 'jump-to-field', payload: { step: number; field: string }): void
}>()

function onIssueClick(path: string): void {
  emit('jump-to-field', { step: fieldToStep(path), field: path })
}

/** 目录树行 */
interface TreeRow {
  path: string
  kind: 'dir' | 'file'
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = []
  const id = store.draft.id || '<id>'
  rows.push({ path: `${id}/`, kind: 'dir' })
  // skills：每勾选一项 → skills/<name>/SKILL.md 行
  for (const s of store.draft.skills) {
    rows.push({ path: `skills/${s.name}/SKILL.md`, kind: 'file' })
  }
  // redlines 有 compiled → hooks/hooks.json 行
  if (store.draft.redlines.some((r) => r.compiled)) {
    rows.push({ path: 'hooks/hooks.json', kind: 'file' })
  }
  // connectors 非空 → mcp.json 行
  if (store.draft.connectors.length > 0) {
    rows.push({ path: 'mcp.json', kind: 'file' })
  }
  // orchestration 需要时 → orchestration/ 行
  if (store.draft.kind === 'flow-owner' && store.draft.usage_modes.includes('+编排')) {
    rows.push({ path: 'orchestration/', kind: 'dir' })
  }
  // commands/knowledge 目录行恒在
  rows.push({ path: 'commands/', kind: 'dir' })
  rows.push({ path: 'knowledge/', kind: 'dir' })
  return rows
})

/** manifest 值（用于 YAML 渲染） */
const manifestValue = computed(() => buildManifestFromDraft(store.draft))

/** YAML 文本 */
const yamlText = computed(() => manifestToYaml(manifestValue.value))

/** YAML 行结构（简易解析：key/value line + plain line） */
interface YamlLine {
  kind: 'kv' | 'plain'
  raw: string
  indent: number
  key?: string
  value?: string
}

function parseYamlLines(text: string): YamlLine[] {
  const out: YamlLine[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    const m = raw.match(/^(\s*)(\S+?):\s*(.*)$/)
    if (m) {
      out.push({ kind: 'kv', raw, indent: m[1].length, key: m[2], value: m[3] })
    } else {
      out.push({ kind: 'plain', raw, indent: 0 })
    }
  }
  return out
}

const yamlLines = computed(() => parseYamlLines(yamlText.value))
</script>

<template>
  <div class="panel">
    <h3>产出物预览</h3>

    <!-- 校验徽章 -->
    <div class="badge" :class="{ ok: isValid, bad: !isValid }" data-role="badge">
      <span v-if="pending" class="badge-text">校验中…</span>
      <button
        v-else
        type="button"
        class="badge-btn"
        data-role="badge-toggle"
        @click="toggleBadge"
      >
        <span class="dot" :class="{ ok: isValid, bad: !isValid }"></span>
        <span v-if="isValid" class="badge-label">校验通过</span>
        <span v-else class="badge-label">失败 {{ issueCount }} 项</span>
        <span v-if="!isValid" class="caret">{{ badgeOpen ? '▾' : '▸' }}</span>
      </button>
    </div>

    <!-- issue 列表 -->
    <ul v-if="!isValid && badgeOpen" class="issue-list" data-role="issue-list">
      <li
        v-for="(issue, idx) in result.issues"
        :key="idx"
        class="issue-item"
        data-issue
        @click="onIssueClick(issue.path)"
      >
        <span class="issue-path">{{ issue.path }}</span>
        <span class="issue-msg">{{ issue.message }}</span>
      </li>
    </ul>

    <!-- 目录树 -->
    <div class="tree" data-role="tree">
      <div class="tree-title">目录结构</div>
      <div
        v-for="(row, idx) in treeRows"
        :key="idx"
        class="tree-row"
        :class="row.kind"
      >
        <span class="tree-icon">{{ row.kind === 'dir' ? '📁' : '📄' }}</span>
        <span class="tree-path">{{ row.path }}</span>
      </div>
    </div>

    <!-- manifest YAML -->
    <div class="yaml-block">
      <div class="yaml-title">manifest.yml</div>
      <pre class="yaml" data-role="manifest-yaml"><span
        v-for="(line, idx) in yamlLines"
        :key="idx"
        class="yaml-line"
      ><span class="yaml-indent">{{ ' '.repeat(line.indent) }}</span><span
          v-if="line.kind === 'kv'"
          class="yaml-key"
        >{{ line.key }}:</span><span
          v-if="line.kind === 'kv' && line.value"
          class="yaml-val"
        > {{ line.value }}</span><span
          v-if="line.kind === 'plain'"
          class="yaml-plain"
        >{{ line.raw }}</span>
</span></pre>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 18px;
}

.panel h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

/* 校验徽章 */
.badge {
  margin-bottom: 12px;
}

.badge-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  font-weight: 600;
}

.badge.ok .badge-btn {
  background: var(--green-50, #ecfdf5);
  color: var(--green-700, #047857);
  border-color: var(--green-200, #a7f3d0);
}

.badge.bad .badge-btn {
  background: var(--red-50, #fef2f2);
  color: var(--red-700, #b91c1c);
  border-color: var(--red-200, #fecaca);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.dot.ok {
  background: var(--green-500, #10b981);
}

.dot.bad {
  background: var(--red-500, #ef4444);
}

.caret {
  font-size: 10px;
  margin-left: 2px;
}

.badge-text {
  font-size: 12.5px;
  color: var(--g600);
  font-weight: 500;
}

/* issue 列表 */
.issue-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  border: 1px solid var(--red-200, #fecaca);
  border-radius: 8px;
  background: var(--red-50, #fef2f2);
  max-height: 200px;
  overflow-y: auto;
}

.issue-item {
  padding: 8px 10px;
  border-bottom: 1px solid var(--red-100, #fee2e2);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
}

.issue-item:last-child {
  border-bottom: none;
}

.issue-item:hover {
  background: var(--red-100, #fee2e2);
}

.issue-path {
  font-family: Menlo, Consolas, monospace;
  color: var(--red-800, #991b1b);
  font-weight: 600;
}

.issue-msg {
  color: var(--g700);
}

/* 目录树 */
.tree {
  margin-bottom: 12px;
}

.tree-title,
.yaml-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g600);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  font-family: Menlo, Consolas, monospace;
  color: var(--g700);
}

.tree-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.tree-row.file .tree-path {
  color: var(--g700);
}

.tree-row.dir .tree-path {
  color: var(--blue-700, #1d4ed8);
  font-weight: 600;
}

/* YAML 块 */
.yaml-block {
  margin-top: 12px;
}

.yaml {
  background: var(--g100, #f3f4f6);
  border: 1px solid var(--g200);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 11.5px;
  font-family: Menlo, Consolas, monospace;
  line-height: 1.55;
  max-height: 320px;
  overflow: auto;
  margin: 0;
  white-space: pre;
}

.yaml-line {
  display: block;
}

.yaml-key {
  color: var(--blue-700, #1d4ed8);
  font-weight: 600;
}

.yaml-val {
  color: var(--g600);
}

.yaml-plain {
  color: var(--g600);
}
</style>
