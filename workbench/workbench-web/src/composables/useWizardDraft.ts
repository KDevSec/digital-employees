import type { WizardDraft } from '../stores/wizard'

/**
 * 向导草稿工具（L1 员工新建线 Task 14）：
 * - slugify(display)：小写 + `[^a-z0-9]+→-` + 去首尾 `-` + 空/CJK 兜底 `employee` + ≤32 截断；
 * - useWizardDraft()：组合 slug 联动（watch display → !idTouched 才同步 draft.id）+
 *   草稿 localStorage（防抖 1s 落键 `devzero:wizard-draft`；restore 时 local 项标 needsReupload:true）。
 *
 * localStorage 草稿：
 * - saveDraft(draft)：deep watch + 防抖 1s → setItem(JSON.stringify(draft skills 里 local 项标 needsReupload:true))；
 * - restoreDraft()：读 localStorage 解析；local skill 项标 needsReupload:true（zip 文件本身不可序列化恢复）；
 * - clearDraft()：移除键；
 * - CreateWizard onMounted → 有草稿 → 「检测到未完成草稿，恢复？」确认条（恢复/丢弃两按钮）。
 */

/** localStorage 键 */
export const DRAFT_KEY = 'devzero:wizard-draft'

/** slug 兜底（空/CJK/全非字母数字） */
const SLUG_FALLBACK = 'employee'

/** slug 最大长度 */
const SLUG_MAX = 32

/**
 * slugify：display → slug
 * - 小写化 + `[^a-z0-9]+→-` + 去首尾 `-`；
 * - 空字符串 / 纯 CJK / 全非字母数字 → 兜底 `employee`；
 * - ≤32 字符（截断后去尾 -）。
 */
export function slugify(display: string): string {
  if (!display) return SLUG_FALLBACK
  const lower = display.toLowerCase()
  const replaced = lower.replace(/[^a-z0-9]+/g, '-')
  // 去首尾 -
  let trimmed = replaced.replace(/^-+|-+$/g, '')
  if (trimmed.length === 0) return SLUG_FALLBACK
  // 截断到 ≤32
  if (trimmed.length > SLUG_MAX) {
    trimmed = trimmed.slice(0, SLUG_MAX)
    // 去尾 -（避免中段悬挂 -）
    trimmed = trimmed.replace(/-+$/g, '')
    if (trimmed.length === 0) return SLUG_FALLBACK
  }
  return trimmed
}

/** 草稿可序列化形状（local skill 标 needsReupload） */
export interface SerializableDraft extends WizardDraft {
  skills: Array<WizardDraft['skills'][number] & { needsReupload?: boolean }>
}

/** 把 draft 序列化为可存形状（local skill 项标 needsReupload:true） */
function toSerializable(draft: WizardDraft): SerializableDraft {
  return {
    ...draft,
    skills: draft.skills.map((s) =>
      s.source_type === 'local' ? { ...s, needsReupload: true } : { ...s },
    ),
  }
}

/** 防抖保存草稿到 localStorage（deep watch draft 触发） */
export function saveDraft(draft: WizardDraft, timer: { value: ReturnType<typeof setTimeout> | null }): void {
  if (timer.value) clearTimeout(timer.value)
  timer.value = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(toSerializable(draft)))
    } catch {
      // localStorage 不可用（隐私模式/配额满）→ 静默跳过（草稿非关键路径）
    }
  }, 1000)
}

/** 读取草稿；不存在/解析失败返回 null */
export function restoreDraft(): SerializableDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SerializableDraft
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

/** 清除草稿 */
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // 静默
  }
}

/**
 * useWizardDraft：组合 slug 联动 + 草稿持久化。
 * 调用方在 CreateWizard setup 中调用，传入 store.draft 的 getRef 与 onChange 回调。
 *
 * 简化：本组合函数不直接接 store（避免循环依赖），调用方负责把 store.draft 与
 * saveDraft/restoreDraft 串联；slug 联动由组件内 watch 实现（见 StepAgent）。
 */
export function useWizardDraft() {
  return {
    slugify,
    saveDraft,
    restoreDraft,
    clearDraft,
    DRAFT_KEY,
  }
}
