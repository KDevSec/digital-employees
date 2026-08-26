<script setup lang="ts">
/**
 * fixture 演出控制条（L5 看板线 T9，dev-only）：剧本四选一 + 播放/暂停/再演。
 * 仅 fixture runtime 在场时由 KanbanView 渲染（live 模式不出现）；品牌口径：
 * 明示「演示」语义，不与真实引擎操作面混淆。
 */
import { computed } from 'vue'
import type { FixtureControls } from '../../fixtures/kanban-fixture-service'
import type { ScenarioName } from '../../fixtures/scenarios'

const props = defineProps<{ controls: FixtureControls }>()

const SCENARIOS: Array<{ value: ScenarioName; label: string }> = [
  { value: 'happy-path', label: '正常推进' },
  { value: 'gate-pause', label: '闸位暂停' },
  { value: 'reflow', label: '评审回流' },
  { value: 'abort', label: '中途终止' },
]

const current = computed(() => props.controls.scenario())

function onPick(e: Event): void {
  props.controls.setScenario((e.target as HTMLSelectElement).value as ScenarioName)
}
</script>

<template>
  <div class="fixture-controls">
    <span class="fc-label">演示</span>
    <select class="fc-select" :value="current" @change="onPick">
      <option v-for="s in SCENARIOS" :key="s.value" :value="s.value">{{ s.label }}</option>
    </select>
    <button class="fc-btn" @click="controls.pause()">暂停</button>
    <button class="fc-btn" @click="controls.resume()">继续</button>
    <button class="fc-btn" @click="controls.replayLast()">再演一遍</button>
    <span class="fc-hint">发起任务即按所选剧本演出（?live=1 切真实引擎）</span>
  </div>
</template>

<style scoped>
/* 演出控制条：violet 系区隔真实操作面（tag-violet 语言），不抢主视觉 */
.fixture-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--violet-bg);
  border: 1px dashed var(--violet);
  border-radius: 10px;
  padding: 7px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--violet);
}

.fc-label {
  font-weight: 700;
}

.fc-select {
  appearance: none;
  background: #fff;
  border: 1px solid var(--g300);
  border-radius: 7px;
  padding: 3px 24px 3px 9px;
  font-size: 12px;
  color: var(--g700);
  cursor: pointer;
}

.fc-btn {
  border: 1px solid var(--g300);
  background: #fff;
  border-radius: 7px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--g600);
  cursor: pointer;
}

.fc-btn:hover {
  border-color: var(--violet);
  color: var(--violet);
}

.fc-hint {
  color: var(--g400);
  font-size: 11px;
  margin-left: auto;
}
</style>
