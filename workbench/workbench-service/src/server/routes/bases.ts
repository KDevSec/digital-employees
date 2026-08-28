/**
 * bases 域路由（设计 §10；探测 CmdRunner 注入——生产装配 main.ts 包装 spawn，测试桩）。
 * - 在场探测走 30min TTL 缓存（~/.devzero/bases/<base>.json，Task 11）；手动刷新端点旁路缓存强探测；
 * - POST /api/bases/probe：带 {base} → 单结果对象；空 body 合法（缺省 = 三底座全刷数组）；
 * - GET /api/bases/:id/models：registry 是静态表无参数路由——path 声明用 :id 占位字面量，
 *   handler 内 ctx.path 切段取底座 id（/api/bases/<id>/models 的倒数第二段）；
 * - GET/PUT /api/bases/:id/tiers：底座全局五档（空串 = 跟随 CLI 默认）；
 * - POST /api/bases/:id/install：登记名单 npm -g，同步+日志，成功后再 probe（D-bb01）。
 */
import { join } from 'node:path'
import { z } from 'zod'
import { listModelsFor } from '../../adapters/common/models'
import type { BaseId } from '../../adapters/contract'
import { baseProfiles } from '../../adapters/index'
import { readCache as readBaseCache, writeCache as writeBaseCache } from '../../bases/cache'
import { NPM_INSTALL_TIMEOUT_MS, REGISTERED_NPM } from '../../bases/npm-packages'
import { assertVersion, probeBase, type CmdRunner } from '../../bases/probe'
import { readTierMap, writeTierMap } from '../../bases/tier-map-store'
import { createDeploymentRegistry } from '../../installs/registry/registry'
import type { Res, RouteRegistry } from '../registry'

const baseIdSchema = z.enum(['claude-code', 'codebuddy', 'qoder'])
const probeSchema = z.object({ base: baseIdSchema.optional() }).strict()
const tierMapSchema = z
  .object({
    评审安全档: z.string(),
    设计档: z.string(),
    探索档: z.string(),
    编码档: z.string(),
    执行档: z.string(),
  })
  .strict()

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
    const result = await listModelsFor(id, deps.run)
    if (!result.ok) {
      const status = result.code === 'NOT_LOGGED_IN' ? 403 : 502
      return err(status, result.code, result.message)
    }
    return { status: 200, json: result.models }
  })

  reg.post('/api/bases/:id/install', async (ctx): Promise<Res> => {
    const id = ctx.path.split('/').slice(-2, -1)[0] as BaseId
    if (!(id in baseProfiles)) return err(404, 'BASE_NOT_FOUND', `未知底座：${id}`)
    const pkg = REGISTERED_NPM[id]
    if (!pkg) return err(404, 'INSTALL_NOT_REGISTERED', `底座未登记安装：${id}`)
    const npm = await deps.run('npm', ['install', '-g', pkg], { timeoutMs: NPM_INSTALL_TIMEOUT_MS })
    const logs = `${npm.stdout}${npm.stderr ?? ''}`
    if (npm.code !== 0) {
      return {
        status: 502,
        json: { error: { code: 'NPM_INSTALL_FAILED', message: `npm install -g ${pkg} 失败` }, logs },
      }
    }
    const presence = await presenceOf(id, deps, true)
    return { status: 200, json: { logs, presence } }
  })

  reg.get('/api/bases/:id/tiers', async (ctx): Promise<Res> => {
    const id = ctx.path.split('/').slice(-2, -1)[0] as BaseId
    if (!(id in baseProfiles)) return err(404, 'BASE_NOT_FOUND', `未知底座：${id}`)
    return { status: 200, json: readTierMap(deps.cacheDir, id) }
  })

  reg.put('/api/bases/:id/tiers', async (ctx): Promise<Res> => {
    const id = ctx.path.split('/').slice(-2, -1)[0] as BaseId
    if (!(id in baseProfiles)) return err(404, 'BASE_NOT_FOUND', `未知底座：${id}`)
    const parsed = tierMapSchema.safeParse(ctx.body ?? {})
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    return { status: 200, json: writeTierMap(deps.cacheDir, id, parsed.data) }
  })
}
