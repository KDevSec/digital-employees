<script setup lang="ts">
import { WIZARD_STEPS } from '../../stores/wizard'

/**
 * 七步步骤条（L1 员工新建线 Task 13，原型 workbench.html page-create `.steps` 段）：
 * - props: currentStep（1~7）；七步名称取自 WIZARD_STEPS（模板/身份/能力/约束/流程/知识/连接器）；
 * - 步态样式：done（已完成 < currentStep）/ cur（== currentStep）/ 默认（> currentStep）；
 * - 点击步骤 emit goto(n)：允许向前/向后跳转（spec W1「分步推进 + 步骤点击可达」）。
 *
 * 视觉沿原型 .step：::before 圆形序号 + ::after 横线连接；done/cur 蓝色填充。
 */

const props = defineProps<{
  currentStep: number
}>()

const emit = defineEmits<{ goto: [n: number] }>()

function stepClass(idx: number): string {
  const n = idx + 1
  if (n < props.currentStep) return 'step done'
  if (n === props.currentStep) return 'step cur'
  return 'step'
}

function onClick(idx: number): void {
  emit('goto', idx + 1)
}
</script>

<template>
  <div class="steps">
    <div
      v-for="(label, idx) in WIZARD_STEPS"
      :key="idx"
      :class="stepClass(idx)"
      :data-n="idx + 1"
      role="button"
      tabindex="0"
      @click="onClick(idx)"
      @keydown.enter.prevent="onClick(idx)"
      @keydown.space.prevent="onClick(idx)"
    >
      {{ label }}
    </div>
  </div>
</template>

<style scoped>
/* 原型 .steps：横向七步 */
.steps {
  display: flex;
  gap: 0;
  margin-bottom: 22px;
}

/* 原型 .step：序号圆 + 文案；::after 横线连到下一步 */
.step {
  flex: 1;
  text-align: center;
  position: relative;
  font-size: 12.5px;
  color: var(--g400);
  padding-top: 24px;
  cursor: pointer;
  transition: 0.15s;
}

.step:hover {
  color: var(--g600);
}

.step::before {
  content: attr(data-n);
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--g200);
  color: var(--g600);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.step::after {
  content: '';
  position: absolute;
  top: 11px;
  left: calc(50% + 16px);
  right: calc(-50% + 16px);
  height: 2px;
  background: var(--g200);
}

.step:last-child::after {
  display: none;
}

.step.done,
.step.cur {
  color: var(--blue-800);
  font-weight: 600;
}

.step.done::before,
.step.cur::before {
  background: var(--blue-600);
  color: #fff;
}

.step.done::after {
  background: var(--blue-500);
}
</style>
