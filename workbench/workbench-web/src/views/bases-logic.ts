/** 底座页纯逻辑（D-bb01）：两张卡始终在、过滤 CC、未登录文案、添加名单。供 BasesView 与单测共用。 */
import { PAGE_BASE_IDS, type BaseCard, type ModelsResult, type PageBaseId } from '../api/bases'

export const PAGE_SEED: Record<PageBaseId, { label: string; mark: string; icon: string }> = {
  codebuddy: { label: 'CodeBuddy', mark: 'CB', icon: 'linear-gradient(135deg,#1d4ed8,#60a5fa)' },
  qoder: { label: 'Qoder', mark: 'Q', icon: 'linear-gradient(135deg,#b45309,#f59e0b)' },
}

export function emptyCard(id: PageBaseId): BaseCard {
  return {
    id,
    label: PAGE_SEED[id].label,
    present: false,
    version: null,
    version_tested: '',
    supported: null,
    employees_count: 0,
    last_install_at: null,
  }
}

/** GET /api/bases 可能含 claude-code；页面只留登记的两张卡，缺席也要占位。 */
export function visibleCards(remote: BaseCard[] | null): BaseCard[] {
  const byId = new Map((remote ?? []).map((c) => [c.id, c]))
  return PAGE_BASE_IDS.map((id) => {
    const hit = byId.get(id)
    return hit ? { ...hit, label: hit.label || PAGE_SEED[id].label } : emptyCard(id)
  })
}

export function statusBadge(card: BaseCard, modelsResult: ModelsResult | undefined): { text: string; tag: string } {
  if (!card.present) return { text: '未安装', tag: 'tag-gray' }
  if (modelsResult && !modelsResult.ok && modelsResult.code === 'NOT_LOGGED_IN') {
    return { text: '未登录', tag: 'tag-amber' }
  }
  if (card.supported === false) return { text: '版本过低', tag: 'tag-amber' }
  return { text: '在场', tag: 'tag-green' }
}

export function modelLine(card: BaseCard, modelsResult: ModelsResult | undefined): string {
  if (!card.present) return '安装后可探测模型'
  if (!modelsResult) return '正在探测模型…'
  if (!modelsResult.ok && modelsResult.code === 'NOT_LOGGED_IN') return '登录后可见'
  if (!modelsResult.ok) return modelsResult.message
  if (modelsResult.models.length === 0) return '已登录，列表为空'
  const head = modelsResult.models.slice(0, 2).map((x) => x.label).join('、')
  return modelsResult.models.length > 2 ? `${head} 等 ${modelsResult.models.length} 个` : head
}

export function canPreview(modelsResult: ModelsResult | undefined): boolean {
  return !!modelsResult && modelsResult.ok && modelsResult.models.length > 0
}

export function addTargets(cards: BaseCard[]): BaseCard[] {
  return cards.filter((c) => !c.present)
}
