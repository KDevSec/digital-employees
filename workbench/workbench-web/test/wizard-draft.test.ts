// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DRAFT_KEY,
  clearDraft,
  flushDraft,
  restoreDraft,
  saveDraft,
  slugify,
} from '../src/composables/useWizardDraft'
import type { WizardDraft } from '../src/stores/wizard'

/**
 * slugify 表驱动（L1 员工新建线 Task 14）：
 * - 小写化 + `[^a-z0-9]+→-` + 去首尾 `-`；
 * - 空字符串 / 纯 CJK / 全非字母数字 → 兜底 `employee`；
 * - ≤32 字符（截断到首个完整 token 边界，避免中段悬挂 `-`）。
 *
 * F1（fix round）：草稿 save/restore 往返测试——序列化/反序列化保真（含 skills/local 项 needsReupload:true 标记落地）
 * + clearDraft 清键验证 + flushDraft 立即落键（unmount flush）。
 */

describe('slugify 表驱动', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['Frontend Dev!', 'frontend-dev'],
    ['frontend-dev', 'frontend-dev'],
    ['  Frontend   Dev  ', 'frontend-dev'],
    ['前端开发', 'employee'], // 纯 CJK 兜底
    ['', 'employee'], // 空兜底
    ['!!!', 'employee'], // 全非字母数字兜底
    ['a b c', 'a-b-c'],
    ['FrontendDev', 'frontenddev'], // 驼峰无分隔也连写
    ['Dev-100', 'dev-100'],
    ['A'.repeat(40), 'a'.repeat(32)], // 32 截断
  ]

  for (const [input, expected] of cases) {
    it(`slugify(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      expect(slugify(input)).toBe(expected)
    })
  }
})

describe('slugify 截断边界', () => {
  it('32 字符内不截断', () => {
    expect(slugify('a'.repeat(32)).length).toBe(32)
  })

  it('超长截断到 ≤32 且不以 - 结尾（去尾 -）', () => {
    const out = slugify('a'.repeat(50))
    expect(out.length).toBeLessThanOrEqual(32)
    expect(out.endsWith('-')).toBe(false)
  })
})

/** 构造测试用 draft（含 template 与 local 两种 skill） */
function makeDraft(): WizardDraft {
  return {
    display: '前端开发',
    id: 'frontend-dev',
    idTouched: true,
    avatar: '🧑‍💻',
    org: 'local',
    identity: '专注前端界面实现。',
    principles: ['增量交付', '证据驱动'],
    usage_modes: ['裸用', '+方法论'],
    kind: 'flow-owner',
    level: 'L1',
    brief: '前端开发员工',
    version: '0.1.0',
    redlines: [{ rule_id: 'no-push-to-main', compiled: false }],
    deny: [],
    tier: '编码档',
    governanceLevel: 'L2',
    visibility: 'team',
    audit: 'exceptions-only',
    connectors: [],
    skills: [
      { name: 'tdd-methodology', version: '1.0.0', source_type: 'template', template_id: 'dev-engineer', description: 'TDD 流程' },
      { name: 'my-skill', version: '0.1.0', source_type: 'local', description: '我的本地 skill' },
    ],
    selectedTemplateId: 'dev-engineer',
  }
}

describe('草稿 save/restore 往返（F1）', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('saveDraft 防抖 1s 落键——1s 内 localStorage 仍为空', () => {
    vi.useFakeTimers()
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    const draft = makeDraft()
    saveDraft(draft, timer)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    vi.advanceTimersByTime(999)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    vi.advanceTimersByTime(2)
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    vi.useRealTimers()
  })

  it('restoreDraft 往返保真：所有 manifest 字段序列化/反序列化无损', () => {
    vi.useFakeTimers()
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    const draft = makeDraft()
    saveDraft(draft, timer)
    vi.advanceTimersByTime(1000)
    const restored = restoreDraft()
    expect(restored).not.toBeNull()
    expect(restored!.display).toBe('前端开发')
    expect(restored!.id).toBe('frontend-dev')
    expect(restored!.idTouched).toBe(true)
    expect(restored!.avatar).toBe('🧑‍💻')
    expect(restored!.identity).toBe('专注前端界面实现。')
    expect(restored!.principles).toEqual(['增量交付', '证据驱动'])
    expect(restored!.usage_modes).toEqual(['裸用', '+方法论'])
    expect(restored!.kind).toBe('flow-owner')
    expect(restored!.level).toBe('L1')
    expect(restored!.brief).toBe('前端开发员工')
    expect(restored!.version).toBe('0.1.0')
    expect(restored!.redlines).toEqual([{ rule_id: 'no-push-to-main', compiled: false }])
    expect(restored!.tier).toBe('编码档')
    expect(restored!.governanceLevel).toBe('L2')
    expect(restored!.visibility).toBe('team')
    expect(restored!.audit).toBe('exceptions-only')
    expect(restored!.selectedTemplateId).toBe('dev-engineer')
    vi.useRealTimers()
  })

  it('restoreDraft：local skill 标 needsReupload:true（zip 不可序列化恢复）；template skill 不标', () => {
    vi.useFakeTimers()
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    saveDraft(makeDraft(), timer)
    vi.advanceTimersByTime(1000)
    const restored = restoreDraft()
    expect(restored).not.toBeNull()
    const localSkill = restored!.skills.find((s) => s.source_type === 'local')
    const templateSkill = restored!.skills.find((s) => s.source_type === 'template')
    expect(localSkill).toBeDefined()
    expect(localSkill!.needsReupload).toBe(true)
    expect(templateSkill).toBeDefined()
    expect(templateSkill!.needsReupload).toBeUndefined()
    vi.useRealTimers()
  })

  it('clearDraft：清除 localStorage 键', () => {
    vi.useFakeTimers()
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    saveDraft(makeDraft(), timer)
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    clearDraft()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(restoreDraft()).toBeNull()
    vi.useRealTimers()
  })

  it('restoreDraft：无草稿时返回 null（不抛错）', () => {
    expect(restoreDraft()).toBeNull()
  })

  it('restoreDraft：损坏 JSON 返回 null（不抛错）', () => {
    localStorage.setItem(DRAFT_KEY, '{invalid json')
    expect(restoreDraft()).toBeNull()
  })
})

describe('flushDraft 立即落键（F4 unmount flush）', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('flushDraft：同步写入 localStorage（不等防抖 1s）', () => {
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    const draft = makeDraft()
    flushDraft(draft, timer)
    // 同步断言：localStorage 立即有值
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    const restored = restoreDraft()
    expect(restored).not.toBeNull()
    expect(restored!.display).toBe('前端开发')
  })

  it('flushDraft：清除 pending 防抖 timer（避免后续重复写）', () => {
    vi.useFakeTimers()
    const timer = { value: null as ReturnType<typeof setTimeout> | null }
    const draft = makeDraft()
    // 先调 saveDraft 设置 pending timer
    saveDraft(draft, timer)
    expect(timer.value).not.toBeNull()
    // flushDraft 清除 timer 并立即落键
    flushDraft(draft, timer)
    expect(timer.value).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    // 推进时间不应再触发额外写入（timer 已清）
    const before = localStorage.getItem(DRAFT_KEY)
    vi.advanceTimersByTime(2000)
    expect(localStorage.getItem(DRAFT_KEY)).toBe(before)
    vi.useRealTimers()
  })
})
