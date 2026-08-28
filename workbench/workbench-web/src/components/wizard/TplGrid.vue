<script setup lang="ts">
import type { TemplateMeta } from '../../api/templates'

/**
 * 模板卡网格（L1 员工新建线 Task 13，原型 workbench.html page-create `.tpl-grid` 段）：
 * - props: templates（7 个 builtin 模板）+ selectedId（当前选中，null=Custom/未选）；
 * - 渲染 8 张卡：7 模板卡 + 1 Custom 卡（末位）；
 * - 卡结构（原型 .tpl-card）：✓ 圆勾 + tpl-head（avatar 字头像 + tpl-name + kind tag）+ tpl-desc + tpl-foot（id 与「使用模板 →」）；
 * - 选中态：.selected 类（原型蓝边 + 蓝 100 阴影）；
 * - emit select(meta | null)：模板卡传 meta，Custom 卡传 null。
 *
 * 头像兜底：avatar 为空时取 display 首字（Custom 卡用「＋」图标）。
 * kind tag 颜色：flow-owner 蓝（tag-blue）/ callee 紫（tag-violet）/ Custom 灰（tag-gray）。
 */

const props = defineProps<{
  templates: TemplateMeta[]
  selectedId: string | null
}>()

const emit = defineEmits<{ select: [meta: TemplateMeta | null] }>()

/** 头像字符兜底：avatar 非空取 avatar，否则取 display 首字 */
function avatarChar(t: TemplateMeta): string {
  if (t.avatar && t.avatar.trim() !== '') return t.avatar
  return t.display.charAt(0) || '?'
}

/** kind tag 类（flow-owner 蓝 / callee 紫） */
function kindTagClass(kind: TemplateMeta['kind']): string {
  return kind === 'flow-owner' ? 'tag tag-blue' : 'tag tag-violet'
}

/** kind tag 文案（与模板 manifest kind 同字段） */
function kindLabel(kind: TemplateMeta['kind']): string {
  return kind
}

/** 卡片点击：模板卡 emit meta，Custom 卡 emit null */
function onClick(meta: TemplateMeta | null): void {
  emit('select', meta)
}
</script>

<template>
  <div class="tpl-grid">
    <div
      v-for="t in props.templates"
      :key="t.id"
      class="tpl-card"
      :class="{ selected: props.selectedId === t.id }"
      role="button"
      tabindex="0"
      @click="onClick(t)"
      @keydown.enter.prevent="onClick(t)"
      @keydown.space.prevent="onClick(t)"
    >
      <div class="check">✓</div>
      <div class="tpl-head">
        <div class="avatar">{{ avatarChar(t) }}</div>
        <div>
          <div class="tpl-name">{{ t.display }}</div>
          <span :class="kindTagClass(t.kind)">{{ kindLabel(t.kind) }}</span>
        </div>
      </div>
      <div class="tpl-desc">{{ t.brief }}</div>
      <div class="tpl-foot">
        <span class="muted">{{ t.id }}</span>
        <span class="link">使用模板 →</span>
      </div>
    </div>

    <!-- Custom 卡：末位，零预填，emit null -->
    <div
      class="tpl-card"
      :class="{ selected: props.selectedId === null && props.templates.length > 0 }"
      role="button"
      tabindex="0"
      @click="onClick(null)"
      @keydown.enter.prevent="onClick(null)"
      @keydown.space.prevent="onClick(null)"
    >
      <div class="check">✓</div>
      <div class="tpl-head">
        <div class="avatar avatar-custom">＋</div>
        <div>
          <div class="tpl-name">Custom</div>
          <span class="tag tag-gray">自定义</span>
        </div>
      </div>
      <div class="tpl-desc">从空白骨架开始，自行定义岗位、职责、原则与能力组合，完全自由的员工定义。</div>
      <div class="tpl-foot">
        <span class="muted">custom</span>
        <span class="link">开始 →</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原型 .tpl-grid：自适应网格（minmax 215px） */
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 14px;
}

/* 原型 .tpl-card：白卡 + g200 边框 + 圆角 14；hover 蓝边 + 上浮 */
.tpl-card {
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: 14px;
  padding: 18px 16px;
  cursor: pointer;
  transition: 0.15s;
  position: relative;
}

.tpl-card:hover {
  border-color: var(--blue-400);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.1);
  transform: translateY(-2px);
}

/* 选中态：蓝边 + 蓝阴影 */
.tpl-card.selected {
  border-color: var(--blue-600);
  box-shadow: 0 0 0 3px var(--blue-100);
}

/* ✓ 圆勾：右上角，仅选中态显示 */
.check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--blue-600);
  color: #fff;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.tpl-card.selected .check {
  display: flex;
}

/* 原型 .tpl-head：avatar + 名称/tag 横排 */
.tpl-head {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 10px;
}

/* 头像字圆（40px 蓝渐变） */
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 15px;
  color: #fff;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--blue-600), var(--blue-400));
}

.avatar.avatar-custom {
  background: linear-gradient(135deg, var(--g500), var(--g400));
}

.tpl-name {
  font-weight: 600;
  font-size: 14.5px;
}

/* 原型 .tag 通用 + 蓝/紫/灰变体（沿 tokens.css 变量） */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.tag-blue {
  background: var(--blue-100);
  color: var(--blue-800);
}

.tag-violet {
  background: var(--violet-bg);
  color: var(--violet);
}

.tag-gray {
  background: var(--g100);
  color: var(--g600);
}

.tpl-desc {
  font-size: 12px;
  color: var(--g500);
  line-height: 1.55;
  min-height: 55px;
}

.tpl-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.muted {
  color: var(--g500);
  font-size: 12px;
}

.link {
  color: var(--blue-600);
  cursor: pointer;
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}
</style>
