<script setup lang="ts">
import { computed, ref } from 'vue'

import { uploadSkillZip } from '../../../api/templates'
import type { SkillMeta } from '../../../api/templates'
import { useWizardStore } from '../../../stores/wizard'

/**
 * Step 3 · Skills 能力配置（L1 员工新建线 Task 14）：
 * - 内置 skill 全集网格（store.skills）——当前模板自带者预勾选+「模板默认」徽章置顶；
 * - 搜索框（name/description 过滤）；
 * - 「上传 skill zip」按钮（POST /api/skills/upload FormData）→ 成功后进已选清单带「本地上传」徽章；
 * - 已选清单行（name@version + 来源徽章 + ✕ 移除）。
 *
 * 勾选语义：
 * - 模板自带 skill：source_type='template' + template_id=素材所属模板；
 * - 跨模板勾选他模板 skill：仍 source_type='template' + template_id=素材所属模板；
 * - 本地上传：source_type='local'。
 *
 * 禁词红线：UI 文案无「底座/安装/AgentHub」。
 */

const store = useWizardStore()
const searchKeyword = ref('')
const uploadError = ref('')
const uploading = ref(false)

/** 搜索过滤后的 skill 全集 */
const filteredSkills = computed<SkillMeta[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return store.skills
  return store.skills.filter(
    (s) => s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw),
  )
})

/** 已选清单（按 draft.skills 顺序） */
const selectedSkills = computed(() => store.draft.skills)

/** skill 是否已勾选 */
function isSkillSelected(name: string): boolean {
  return store.draft.skills.some((s) => s.name === name)
}

/** 模板默认徽章：该 skill 属于当前选中模板 */
function isTemplateDefault(skill: SkillMeta): boolean {
  return store.draft.selectedTemplateId !== null && skill.templateId === store.draft.selectedTemplateId
}

/** 切换 skill 勾选态 */
function toggleSkill(skill: SkillMeta): void {
  if (isSkillSelected(skill.name)) {
    store.draft.skills = store.draft.skills.filter((s) => s.name !== skill.name)
  } else {
    store.draft.skills = [
      ...store.draft.skills,
      {
        name: skill.name,
        version: skill.version,
        source_type: 'template',
        template_id: skill.templateId,
        description: skill.description,
      },
    ]
  }
}

/** 移除已选 skill */
function removeSkill(name: string): void {
  store.draft.skills = store.draft.skills.filter((s) => s.name !== name)
}

/** 上传 zip */
async function onUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  uploadError.value = ''
  try {
    const uploaded = await uploadSkillZip(file)
    store.draft.skills = [
      ...store.draft.skills,
      {
        name: uploaded.name,
        version: uploaded.version,
        source_type: 'local',
        description: uploaded.description,
      },
    ]
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '上传失败'
  } finally {
    uploading.value = false
    // 重置 input 以便重复上传同名文件
    input.value = ''
  }
}
</script>

<template>
  <div class="cat-section">
    <div class="cat-section-label"><span class="cat-icon">⚡</span> 能力 —— 员工会什么</div>

    <div class="form-row">
      <label>能力 Skills（写入 skills 集，可跨员工复用、独立版本管理）</label>
      <div class="toolbar">
        <input
          class="input search-input"
          data-role="skill-search"
          v-model="searchKeyword"
          placeholder="搜索 skill 名称或描述"
        />
        <label class="btn btn-ghost upload-btn" :class="{ disabled: uploading }">
          {{ uploading ? '上传中…' : '⬆ 上传 skill zip' }}
          <input type="file" accept=".zip" :disabled="uploading" @change="onUpload" hidden />
        </label>
      </div>
      <p v-if="uploadError" class="error-msg">{{ uploadError }}</p>
    </div>

    <div class="form-row">
      <div class="skill-grid-compact">
        <div
          v-for="skill in filteredSkills"
          :key="skill.name"
          class="skill-card skill-card-clamped"
          :class="{ on: isSkillSelected(skill.name) }"
          data-skill
          @click="toggleSkill(skill)"
        >
          <div class="skill-info">
            <div class="skill-name">
              {{ skill.name }}
              <span v-if="isTemplateDefault(skill)" class="badge badge-default">模板默认</span>
            </div>
            <div class="skill-desc">{{ skill.description }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="form-row" v-if="selectedSkills.length > 0">
      <label>已选清单</label>
      <div class="selected-list">
        <div v-for="s in selectedSkills" :key="s.name" class="selected-row">
          <span class="sel-name">{{ s.name }}@{{ s.version }}</span>
          <span class="badge" :class="s.source_type === 'local' ? 'badge-local' : 'badge-template'">
            {{ s.source_type === 'local' ? '本地上传' : '模板' }}
          </span>
          <!-- F2：local skill 在草稿恢复场景下 needsReupload=true（zip 文件本身不可序列化恢复）→ 显示 amber 徽章提示用户重传 -->
          <span v-if="s.needsReupload === true" class="badge badge-reupload" data-role="needs-reupload">
            需重新上传
          </span>
          <button type="button" class="remove-btn" aria-label="移除" @click="removeSkill(s.name)">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cat-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--g200);
}

.cat-section-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cat-icon {
  font-size: 16px;
}

.form-row {
  margin-bottom: 16px;
}

.form-row label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--g700);
  margin-bottom: 6px;
}

.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-input {
  flex: 1;
}

.input {
  width: 100%;
  border: 1px solid var(--g300);
  border-radius: 9px;
  padding: 9px 13px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  background: #fff;
}

.input:focus {
  border-color: var(--blue-500);
  box-shadow: 0 0 0 3px var(--blue-100);
}

.upload-btn {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  padding: 8px 16px;
  font-size: 13px;
  border: 1px solid var(--g300);
  background: #fff;
  color: var(--g700);
  font-weight: 500;
  transition: 0.15s;
}

.upload-btn:hover {
  border-color: var(--blue-400);
  color: var(--blue-700);
}

.upload-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg {
  color: var(--red);
  font-size: 12.5px;
  margin-top: 6px;
}

/* demo .skill-grid：自适应网格（minmax 230px） + 卡片式（无 checkbox，点选即切换） */
.skill-grid-compact {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px;
}

.skill-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1.5px solid var(--g200);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 12.5px;
  cursor: pointer;
  transition: 0.12s;
  background: #fff;
}

.skill-card:hover {
  border-color: var(--blue-400);
}

.skill-card.on {
  border-color: var(--blue-600);
  background: var(--blue-50);
}

/* 卡片压缩：描述截 2 行，无 min-height */
.skill-card-clamped .skill-desc {
  font-size: 11.5px;
  color: var(--g500);
  margin-top: 3px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* demo .skill-desc：截 2 行（line-clamp），无 min-height */
.skill-desc {
  font-size: 11.5px;
  color: var(--g500);
  margin-top: 3px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 500;
}

.badge-default {
  background: var(--blue-100);
  color: var(--blue-800);
}

.badge-template {
  background: var(--g100);
  color: var(--g600);
}

.badge-local {
  background: var(--green-bg);
  color: var(--green);
}

/* F2：需重新上传徽章（amber 色系——草稿恢复场景 local skill 的 zip 文件不可序列化恢复） */
.badge-reupload {
  background: var(--amber-bg);
  color: var(--amber);
}

/* 已选清单 */
.selected-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.selected-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  background: var(--g100);
  border-radius: 8px;
  font-size: 12.5px;
}

.sel-name {
  flex: 1;
  font-family: Menlo, Consolas, monospace;
}

.remove-btn {
  border: none;
  background: transparent;
  color: var(--g500);
  cursor: pointer;
  font-size: 13px;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remove-btn:hover {
  background: var(--red-bg);
  color: var(--red);
}
</style>
