/**
 * bases 域路由（设计 §10；探测 CmdRunner 注入——生产装配 main.ts 包装 spawn，测试桩）。
 * - 在场探测走 30min TTL 缓存（~/.devzero/bases/<base>.json，Task 11）；手动刷新端点旁路缓存强探测；
 * - POST /api/bases/probe：带 {base} → 单结果对象；空 body 合法（缺省 = 三底座全刷数组）；
 * - GET /api/bases/:id/models：registry 是静态表无参数路由——path 声明用 :id 占位字面量，
 *   handler 内 ctx.path 切段取底座 id（/api/bases/<id>/models 的倒数第二段）。
 */
import { join } from 'node:path'
import { z } from 'zod'
import { listModelsFor } from '../../adapters/common/models'
import type { BaseId } from '../../adapters/contract'
import { baseProfiles } from '../../adapters/index'
import { readCache as readBaseCache, writeCache as writeBaseCache } from '../../bases/cache'
import { assertVersion, probeBase, type CmdRunner } from '../../bases/probe'
import { createDeploymentRegistry } from '../../installs/registry/registry'
import type { Res, RouteRegistry } from '../registry'

const baseIdSchema = z.enum(['claude-code', 'codebuddy', 'qoder'])
const probeSchema = z.object({ base: baseIdSchema.optional() }).strict()

export interface BasesRouteDeps {
  /** 探测缓存目录（~/.devzero/bases/；文件名 <base>.json） */
  cacheDir: string
  /** 命令执行注入（生产 = spawn 包装；测试 = 桩） */
  run: CmdRunner
  /** Deployment 台账文件（卡片 employees_count / last_install_at 数据源） */
  registryFile: string
}

/** 底座卡片（GET /api/bases 响应元素，设计 §10） */
interface BaseCard {
  id: BaseId
  label: string
  present: boolean
  version: string | null
  version_tested: string
  /** 在场时的版本区间断言结论；不在场为 null（无从断言） */
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

/** 探测结果卡片（POST /api/bases/probe：单底座为对象、缺省全刷为数组） */
interface ProbeCard {
  base: BaseId
  present: boolean
  version: string | null
  probed_at: string
  supported: boolean
}

/** 在场性（缓存优先；force=true 旁路缓存强探测并回写——手动刷新语义） */
async function presenceOf(base: BaseId, deps: BasesRouteDeps, force: boolean) {
  const cacheFile = join(deps.cacheDir, `${base}.json`)
  if (!force) {
    const cached = readBaseCache(cacheFile)
    if (cached) return cached
  }
  const p = await probeBase(baseProfiles[base], deps.run)
  writeBaseCache(cacheFile, p)
  return p
}

function err(status: number, code: string, message: string): Res {
  return { status, json: { error: { code, message } } }
}

export function registerBasesRoutes(reg: RouteRegistry, deps: BasesRouteDeps): void {
  reg.get('/api/bases', async (): Promise<Res> => {
    const registry = createDeploymentRegistry(deps.registryFile)
    const cards: BaseCard[] = []
    for (const profile of Object.values(baseProfiles)) {
      const p = await presenceOf(profile.id, deps, false)
      const installs = registry.list().filter((d) => d.base === profile.id)
      cards.push({
        id: profile.id,
        label: profile.label,
        present: p.present,
        version: p.version,
        version_tested: profile.version_tested,
        supported: p.present ? assertVersion(profile, p).ok : null,
        employees_count: installs.length,
        last_install_at: installs.map((d) => d.installed_at).sort().pop() ?? null,
      })
    }
    return { status: 200, json: cards }
  })

  reg.post('/api/bases/probe', async (ctx): Promise<Res> => {
    const parsed = probeSchema.safeParse(ctx.body ?? {}) // 空 body 合法（缺省 = 全刷）
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    const toCard = async (base: BaseId): Promise<ProbeCard> => {
      const p = await presenceOf(base, deps, true) // 手动刷新：缓存旁路
      return { base, ...p, supported: assertVersion(baseProfiles[base], p).ok }
    }
    if (parsed.data.base) return { status: 200, json: await toCard(parsed.data.base) }
    const out: ProbeCard[] = []
    for (const base of Object.keys(baseProfiles) as BaseId[]) out.push(await toCard(base))
    return { status: 200, json: out }
  })

  reg.get('/api/bases/:id/models', async (ctx): Promise<Res> => {
    // 静态表哲学（无参数路由）：path 声明用 :id 占位，handler 内 ctx.path 切段取底座 id（倒数第二段）
    const id = ctx.path.split('/').slice(-2, -1)[0] as BaseId
    if (!(id in baseProfiles)) return err(404, 'BASE_NOT_FOUND', `未知底座：${id}`)
    return { status: 200, json: await listModelsFor(id) }
  })
}
