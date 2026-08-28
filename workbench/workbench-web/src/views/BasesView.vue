<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  fetchBases,
  fetchBaseModels,
  fetchTierConfig,
  probeBases,
  saveTierConfig,
  type BaseCard,
  type BaseId,
  type ModelInfo,
  type TierConfig,
} from '../api/bases'

/**
 * 底座与环境页（L2 安装线填充 I0-5 预留版面，路由注释 B-04/B-05/B-06；D-062 档位配置化）：
 * - 底座区：三底座卡片（GET /api/bases）——在场显示版本/断言结论/已装员工数；
 *   不在场灰置「未检测到」；「重新探测」POST /api/bases/probe 旁路缓存后刷新列表。
 * - 档位配置面板（D-062）：选中底座 → GET tier-config（合并映射 + customized 清单）+
 *   GET models（候选下拉数据源）→ 五档下拉分配模型 → 保存 PUT（载荷五档齐全）；
 *   customized 档位显示「自定义」徽标；保存失败常驻错误文案（纪律⑥非 toast）。
 * - 零假数据：bases 空数组 → 不渲染卡片与配置面板（数据纯 bases 域 API，无静态残留）。
 */

/** 档位名序（与 service TIER_ORDER 同序） */
const TIER_NAMES = ['评审安全档', '设计档', '探索档', '编码档', '执行档'] as const

/** 底座卡片清单 */
const baseCards = ref<BaseCard[]>([])
/** 探测 pending（「重新探测」按钮点击中） */
const probePending = ref(false)

/** 当前选中底座（档位配置面板对象；未选 = null） */
const selectedBase = ref<BaseId | null>(null)
/** 面板内合并映射（编辑中副本；保存前不碰服务端） */
const editTiers = ref<Record<string, string>>({})
/** 服务端回传的 customized 档位清单（徽标数据源；保存后按响应刷新） */
const customized = ref<string[]>([])
/** 候选模型清单（models 端点去重 id 保持出现序） */
const modelOptions = ref<string[]>([])
/** 面板加载中（tier-config/models 并行拉取） */
const configLoading = ref(false)
/** 保存 pending/常驻错误 */
const savePending = ref(false)
const saveError = ref<string | null>(null)
/** 保存成功一次性提示（下次编辑或切换底座清除） */
const savedOnce = ref(false)

onMounted(async () => {
  baseCards.value = await fetchBases()
})

/** 已选底座对象（面板头渲染） */
const selectedCard = computed(() => baseCards.value.find((c) => c.id === selectedBase.value) ?? null)

/** 重新探测（同 InstallModal 口径：probe 后 GET 刷新） */
async function reprobe(): Promise<void> {
  if (probePending.value) return
  probePending.value = true
  try {
    await probeBases()
    baseCards.value = await fetchBases()
    // 刷新后若选中底座被过滤为不在场仍可配置（配置与在场性解耦——预配未到底座场景）
  } finally {
    probePending.value = false
  }
}

/** 选中底座 → 打开档位配置面板（并行拉 tier-config + models；失败各自归一空态） */
async function selectBase(card: BaseCard): Promise<void> {
  selectedBase.value = card.id
  saveError.value = null
  savedOnce.value = false
  configLoading.value = true
  try {
    const [cfg, models] = await Promise.all([
      fetchTierConfig(card.id),
      fetchBaseModels(card.id),
    ])
    editTiers.value = { ...(cfg?.tiers ?? {}) }
    customized.value = cfg?.customized ?? []
    // 候选 = models 端点合并后 id（去重保持出现序——同 id 多档只留一条）
    const seen = new Set<string>()
    const opts: string[] = []
    for (const m of models) {
      if (!seen.has(m.id)) {
        seen.add(m.id)
        opts.push(m.id)
      }
    }
    modelOptions.value = opts
  } finally {
    configLoading.value = false
  }
}

/** 保存档位映射（PUT 全五档；响应刷新 customized/编辑副本；失败常驻错误） */
async function onSave(): Promise<void> {
  if (!selectedBase.value || savePending.value) return
  savePending.value = true
  saveError.value = null
  savedOnce.value = false
  try {
    const result = await saveTierConfig(selectedBase.value, { ...editTiers.value })
    if (result.ok) {
      editTiers.value = { ...result.config.tiers }
      customized.value = result.config.customized
      savedOnce.value = true
    } else {
      saveError.value = result.error
    }
  } finally {
    savePending.value = false
  }
}

/** 用户改动档位 -> 清成功态（徽标以服务端数据为准，不预判） */
function onEditTier(): void {
  savedOnce.value = false
}
</script>

<template>
  <section class="bases-page">
    <header class="page-head">
      <div>
        <h1>底座与环境</h1>
        <p class="sub">底座在场探测与模型档位配置</p>
      </div>
      <button
        type="button"
        class="btn btn-ghost"
        data-role="probe-btn"
        :disabled="probePending"
        @click="reprobe"
      >{{ probePending ? '探测中…' : '重新探测' }}</button>
    </header>

    <div v-if="baseCards.length === 0" class="empty-hint" data-role="empty-hint">
      未检测到任何底座
    </div>

    <template v-else>
      <!-- 底座区 -->
      <div class="base-grid">
        <div
          v-for="c in baseCards"
          :key="c.id"
          class="base-card"
          :class="{ on: selectedBase === c.id, disabled: !c.present }"
          data-role="base-card"
          :data-base="c.id"
          :data-present="c.present ? 'true' : 'false'"
          @click="selectBase(c)"
        >
          <div class="base-name">{{ c.label }}</div>
          <div class="base-id">{{ c.id }}</div>
          <template v-if="c.present">
            <div class="base-version">{{ c.version ?? '未知版本' }}</div>
            <div class="base-status" :data-supported="c.supported ? 'true' : 'false'">
              {{ c.supported ? '已支持' : '版本低于断言基线' }}
            </div>
            <div class="base-employees">{{ c.employees_count }} 名员工</div>
          </template>
          <div v-else class="base-absent" data-role="absent-label">未检测到</div>
        </div>
      </div>

      <!-- 档位配置面板（选中底座后出现） -->
      <div v-if="selectedCard" class="tier-panel card" data-role="tier-config-panel">
        <div class="panel-head">
          <div class="panel-title">模型档位映射 —— {{ selectedCard.label }}</div>
          <div class="panel-sub">发起任务选档位，按此映射落具体模型；默认「随底座」即用本页配置</div>
        </div>

        <div v-if="configLoading" class="panel-loading">配置加载中…</div>

        <template v-else>
          <div
            v-for="t in TIER_NAMES"
            :key="t"
            class="tier-row"
            data-role="tier-row"
          >
            <div class="tier-name" data-role="tier-name">
              {{ t }}
              <span v-if="customized.includes(t)" class="customized-badge" data-role="customized-badge">自定义</span>
            </div>
            <select
              class="tier-select"
              data-role="tier-select"
              v-model="editTiers[t]"
              @change="onEditTier"
            >
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
              <!-- 当前值不在候选清单（如自定义 id 历史配置）时补显，防 select 空白 -->
              <option v-if="editTiers[t] && !modelOptions.includes(editTiers[t])" :value="editTiers[t]">{{ editTiers[t] }}</option>
            </select>
          </div>

          <div class="panel-foot">
            <span v-if="savedOnce" class="save-ok" data-role="save-ok">已保存</span>
            <span v-if="saveError" class="save-error" data-role="save-error">{{ saveError }}</span>
            <button
              type="button"
              class="btn btn-primary"
              data-role="save-tier-config"
              :disabled="savePending"
              @click="onSave"
            >{{ savePending ? '保存中…' : '保存档位映射' }}</button>
          </div>
        </template>
      </div>
    </template>
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

.empty-hint {
  text-align: center;
  padding: 56px 12px;
  font-size: 13px;
  color: var(--g500);
}

.base-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.base-card {
  border: 1.5px solid var(--g200, #e5e7eb);
  border-radius: 12px;
  padding: 16px 14px;
  cursor: pointer;
  background: #fff;
  transition: 0.12s;
}

.base-card:hover {
  border-color: var(--blue-300, #93c5fd);
}

.base-card.on {
  border-color: var(--blue-600, #2563eb);
  background: var(--blue-50, #eff6ff);
  box-shadow: 0 0 0 2px var(--blue-100, #dbeafe);
}

.base-card.disabled {
  cursor: pointer; /* 不在场也可选中——预配未到底座场景（配置与在场性解耦） */
  background: var(--g100, #f3f4f6);
}

.base-name {
  font-weight: 600;
  font-size: 14px;
}

.base-id {
  font-family: Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--g500, #6b7280);
  margin-top: 2px;
}

.base-version {
  margin-top: 8px;
  font-size: 12px;
  font-family: Menlo, Consolas, monospace;
  color: var(--g700, #374151);
}

.base-status {
  margin-top: 4px;
  font-size: 11.5px;
  color: #166534;
}

.base-status[data-supported='false'] {
  color: #b45309;
}

.base-employees {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--g600, #4b5563);
}

.base-absent {
  margin-top: 8px;
  font-size: 12px;
  color: var(--g500, #6b7280);
}

.card {
  background: #fff;
  border: 1px solid var(--g200);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(30, 64, 175, 0.05);
}

.tier-panel {
  margin-top: 16px;
  padding: 18px 20px;
}

.panel-head {
  margin-bottom: 14px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.panel-sub {
  font-size: 12px;
  color: var(--g500);
  margin-top: 3px;
}

.panel-loading {
  padding: 24px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--g500);
}

.tier-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--g100, #f3f4f6);
}

.tier-row:last-of-type {
  border-bottom: none;
}

.tier-name {
  font-size: 13px;
  font-weight: 500;
  min-width: 110px;
}

.customized-badge {
  margin-left: 6px;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--blue-100, #dbeafe);
  color: var(--blue-700, #1d4ed8);
  font-weight: 500;
}

.tier-select {
  flex: 1;
  max-width: 320px;
  border: 1px solid var(--g300, #d1d5db);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-family: Menlo, Consolas, monospace;
  outline: none;
  background: #fff;
}

.tier-select:focus {
  border-color: var(--blue-500, #3b82f6);
  box-shadow: 0 0 0 3px var(--blue-100, #dbeafe);
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.save-ok {
  font-size: 12px;
  color: #166534;
}

.save-error {
  font-size: 12px;
  color: #991b1b;
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
  font-weight: 500;
  font-family: inherit;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--blue-600, #2563eb);
  color: #fff;
}

.btn-primary:not(:disabled):hover {
  background: var(--blue-700, #1d4ed8);
}

.btn-ghost {
  background: #fff;
  border-color: var(--g300, #d1d5db);
  color: var(--g700, #374151);
}

.btn-ghost:hover {
  border-color: var(--blue-400, #60a5fa);
  color: var(--blue-700, #1d4ed8);
}
</style>
