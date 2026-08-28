<script setup lang="ts">
/**
 * 底座与环境页（D-bb01）：V0.1 只展示 CodeBuddy + Qoder 两张卡（始终在，含未安装）。
 * 不展示员工数；模型走 CLI 探测（未登录 =「登录后可见」）；安装双入口走 POST /api/bases/:id/install。
 * 五档全局默认：探测列表里选，空 = 跟随 CLI 默认；任务表单可覆盖、默认跟这里。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  PAGE_BASE_IDS,
  TIER_ORDER,
  emptyTierMap,
  fetchBases,
  fetchModels,
  fetchTierMap,
  installBase,
  probeBases,
  saveTierMap,
  type BaseCard,
  type BaseTierMap,
  type ModelsResult,
  type PageBaseId,
  type TierName,
} from '../api/bases'
import {
  PAGE_SEED,
  addTargets as pickAddTargets,
  canPreview,
  emptyCard,
  modelLine,
  statusBadge,
  tierSelectOptions,
  visibleCards,
} from './bases-logic'

const cards = ref<BaseCard[]>(PAGE_BASE_IDS.map(emptyCard))
const models = reactive<Record<string, ModelsResult | undefined>>({})
const tiers = reactive<Record<string, BaseTierMap>>(
  Object.fromEntries(PAGE_BASE_IDS.map((id) => [id, emptyTierMap()])),
)
const installing = ref<string | null>(null)
const installLogs = ref('')
const addOpen = ref(false)
const previewId = ref<string | null>(null)
const probing = ref(false)
const tierSaveError = ref('')

const addList = computed(() => pickAddTargets(cards.value))
const previewCard = computed(() => cards.value.find((c) => c.id === previewId.value) ?? null)
const previewModels = computed(() => {
  const r = previewId.value ? models[previewId.value] : undefined
  return r?.ok ? r.models : []
})

function modelsOf(id: string) {
  const r = models[id]
  return r?.ok ? r.models : []
}

function selectedTier(id: string, tier: TierName): string {
  return (tiers[id] ?? emptyTierMap())[tier]
}

async function loadModels(id: string, present: boolean): Promise<void> {
  if (!present) {
    models[id] = undefined
    return
  }
  models[id] = await fetchModels(id)
}

async function loadTiers(id: string): Promise<void> {
  tiers[id] = (await fetchTierMap(id)) ?? emptyTierMap()
}

async function loadAll(forceProbe: boolean): Promise<void> {
  if (forceProbe) {
    probing.value = true
    await probeBases()
    probing.value = false
  }
  cards.value = visibleCards(await fetchBases())
  await Promise.all(cards.value.map(async (c) => {
    await loadModels(c.id, c.present)
    await loadTiers(c.id)
  }))
}

function seedOf(id: string) {
  return PAGE_SEED[id as PageBaseId]
}

async function onTierChange(id: string, tier: TierName, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  const next = { ...(tiers[id] ?? emptyTierMap()), [tier]: value }
  tiers[id] = next
  tierSaveError.value = ''
  const ok = await saveTierMap(id, next)
  if (!ok) tierSaveError.value = '档位保存失败，请重试'
}

async function install(id: string): Promise<void> {
  installing.value = id
  installLogs.value = ''
  const result = await installBase(id)
  installLogs.value = result.ok ? result.logs : (result.logs ?? result.message)
  installing.value = null
  addOpen.value = false
  await loadAll(true)
}

onMounted(() => {
  void loadAll(false)
})
</script>

<template>
  <section class="bases">
    <header class="page-head">
      <div>
        <h1>底座与环境</h1>
        <p class="sub">本机 CLI 探测与登记名单安装 · 五档全局默认，任务可覆盖</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-ghost" :disabled="probing" @click="loadAll(true)">
          ⟳ 刷新探测
        </button>
        <button type="button" class="btn btn-primary" data-action="add" @click="addOpen = true">＋ 添加</button>
      </div>
    </header>

    <div class="host-grid">
      <article v-for="card in cards" :key="card.id" class="host-card" :class="{ dim: !card.present }">
        <div class="host-head">
          <div class="host-icon" :style="{ background: seedOf(card.id).icon }">
            {{ seedOf(card.id).mark }}
          </div>
          <div class="host-meta">
            <div class="host-name">{{ card.label }}</div>
            <div class="host-sub">{{ card.present ? (card.version ? `v${card.version}` : '版本未知') : '未在 PATH 中' }}</div>
          </div>
          <span class="tag" :class="statusBadge(card, models[card.id]).tag">{{ statusBadge(card, models[card.id]).text }}</span>
        </div>

        <div class="model-row">
          <span class="muted">{{ modelLine(card, models[card.id]) }}</span>
          <button
            v-if="canPreview(models[card.id])"
            type="button"
            class="link"
            @click="previewId = card.id"
          >预览</button>
        </div>

        <div class="tier-block">
          <div class="tier-head">模型档位 · 全局默认，任务可覆盖</div>
          <label v-for="tier in TIER_ORDER" :key="tier" class="tier-row">
            <span>{{ tier }}</span>
            <select
              :value="selectedTier(card.id, tier)"
              :data-base="card.id"
              :data-tier="tier"
              @change="onTierChange(card.id, tier, $event)"
            >
              <option
                v-for="opt in tierSelectOptions(selectedTier(card.id, tier), modelsOf(card.id))"
                :key="opt.value === '' ? '__empty' : opt.value"
                :value="opt.value"
              >{{ opt.label }}</option>
            </select>
          </label>
        </div>

        <div class="host-foot">
          <span class="muted">{{ card.present ? 'CLI --version 在场' : '可从登记名单 npm 安装' }}</span>
          <button
            v-if="!card.present"
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="installing === card.id"
            @click="install(card.id)"
          >{{ installing === card.id ? '安装中…' : '安装' }}</button>
        </div>
      </article>
    </div>

    <pre v-if="installLogs" class="logs">{{ installLogs }}</pre>
    <p v-if="tierSaveError" class="form-error">{{ tierSaveError }}</p>

    <div v-if="addOpen" class="modal-mask" data-panel="add" @click.self="addOpen = false">
      <div class="modal" role="dialog" aria-labelledby="add-title">
        <div class="modal-head">
          <b id="add-title">添加底座</b>
          <button type="button" class="modal-close" @click="addOpen = false">×</button>
        </div>
        <div class="modal-body">
          <p v-if="addList.length === 0" class="muted">登记名单里的底座都已在场。</p>
          <ul v-else class="add-list">
            <li v-for="t in addList" :key="t.id">
              <span>{{ t.label }}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="installing === t.id"
                @click="install(t.id)"
              >{{ installing === t.id ? '安装中…' : '安装' }}</button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div v-if="previewCard" class="modal-mask" data-panel="preview" @click.self="previewId = null">
      <div class="modal" role="dialog">
        <div class="modal-head">
          <b>{{ previewCard.label }} 模型</b>
          <button type="button" class="modal-close" @click="previewId = null">×</button>
        </div>
        <ul class="model-list">
          <li v-for="m in previewModels" :key="m.id">{{ m.label }}<small v-if="m.id !== m.label">{{ m.id }}</small></li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
}

h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin: 0;
}

.sub {
  color: var(--g500);
  margin-top: 5px;
  font-size: 13px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.host-card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  padding: 19px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.host-card.dim {
  opacity: 0.78;
}

.host-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.host-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
  color: #fff;
  flex-shrink: 0;
}

.host-meta {
  flex: 1;
  min-width: 0;
}

.host-name {
  font-weight: 700;
  font-size: 15px;
}

.host-sub {
  font-size: 11.5px;
  color: var(--g500);
  margin-top: 2px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.tag-green {
  background: var(--green-bg);
  color: var(--green);
}

.tag-amber {
  background: var(--amber-bg);
  color: var(--amber);
}

.tag-gray {
  background: var(--g100);
  color: var(--g600);
}

.model-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.tier-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--g100);
}

.tier-head {
  font-size: 11.5px;
  color: var(--g500);
  margin-bottom: 8px;
}

.tier-row {
  display: grid;
  grid-template-columns: 7.5em 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--g700);
}

.tier-row select {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 12px;
  background: #fff;
}

.form-error {
  margin-top: 12px;
  color: var(--red);
  font-size: 13px;
}

.muted {
  color: var(--g500);
  font-size: 12.5px;
}

.link {
  background: none;
  border: 0;
  color: var(--blue-700);
  cursor: pointer;
  font-size: 12.5px;
  padding: 0;
}

.host-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--g100);
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.15s;
  font-weight: 500;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-primary {
  background: var(--blue-600);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--blue-700);
}

.btn-ghost {
  background: #fff;
  border-color: var(--g300);
  color: var(--g700);
}

.btn-ghost:hover:not(:disabled) {
  border-color: var(--blue-400);
  color: var(--blue-700);
}

.btn-sm {
  padding: 5px 11px;
  font-size: 12px;
  border-radius: 7px;
}

.logs {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--g100);
  border-radius: 10px;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 180px;
  overflow: auto;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  padding: 24px;
}

.modal {
  background: #fff;
  border-radius: 14px;
  width: min(420px, 100%);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--g100);
}

.modal-close {
  border: 0;
  background: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--g500);
  line-height: 1;
}

.modal-body {
  padding: 16px;
}

.add-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.add-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.model-list {
  list-style: none;
  padding: 12px 16px 16px;
  max-height: 320px;
  overflow: auto;
}

.model-list li {
  padding: 8px 0;
  border-bottom: 1px solid var(--g100);
  font-size: 13px;
}

.model-list small {
  display: block;
  color: var(--g500);
  font-size: 11.5px;
}
</style>
