/**
 * bases 域路由（设计 §10；探测 CmdRunner 注入——生产装配 main.ts 包装 spawn，测试桩）。
 * - GET /api/bases/:id/models：CLI 真列表（未登录 403 / 失败 502）；
 * - GET/PUT /api/bases/:id/tiers：底座全局五档（空串 = 跟随 CLI 默认）；
 * - GET/PUT /api/bases/:id/tier-config：D-062 内置默认 + 用户覆盖（任务发起消费）；
 * - POST /api/bases/:id/install：登记名单 npm -g，同步+日志，成功后再 probe。
 */
import { join } from 'node:path'
import { z } from 'zod'
import { listModelsFor } from '../../adapters/common/models'
import { TIER_ORDER, type TierName } from '../../adapters/common/tier-map'
import type { BaseId } from '../../adapters/contract'
import { baseProfiles } from '../../adapters/index'
import { readCache as readBaseCache, writeCache as writeBaseCache } from '../../bases/cache'
import { NPM_INSTALL_TIMEOUT_MS, REGISTERED_NPM } from '../../bases/npm-packages'
import { assertVersion, probeBase, type CmdRunner } from '../../bases/probe'
import { resolveTierConfig, saveTierConfig } from '../../bases/tier-config'
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
/** PUT tier-config：五档齐全且值非空（D-062） */
const tierConfigSchema = z.object({
  tiers: z.record(z.string()).refine(
    (t) => TIER_ORDER.every((k) => typeof t[k] === 'string' && t[k].length > 0),
    { message: '五档映射必须齐全且值非空' },
  ),
}).strict()

export interface BasesRouteDeps {
  cacheDir: string
  run: CmdRunner
  registryFile: string
  tierConfigFile: string
}

interface BaseCard {
  id: BaseId
  label: string
  present: boolean
  version: string | null
  version_tested: string
  supported: boolean | null
  employees_count: number
  last_install_at: string | null
}

interface ProbeCard {
  base: BaseId
  present: boolean
  version: string | null
  probed_at: string
  supported: boolean
}

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

function baseIdFromPath(path: string): BaseId | null {
  const id = path.split('/').slice(-2, -1)[0] as BaseId
  return id in baseProfiles ? id : null
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
    const parsed = probeSchema.safeParse(ctx.body ?? {})
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    const toCard = async (base: BaseId): Promise<ProbeCard> => {
      const p = await presenceOf(base, deps, true)
      return { base, ...p, supported: assertVersion(baseProfiles[base], p).ok }
    }
    if (parsed.data.base) return { status: 200, json: await toCard(parsed.data.base) }
    const out: ProbeCard[] = []
    for (const base of Object.keys(baseProfiles) as BaseId[]) out.push(await toCard(base))
    return { status: 200, json: out }
  })

  reg.get('/api/bases/:id/models', async (ctx): Promise<Res> => {
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
    const result = await listModelsFor(id, deps.run)
    if (!result.ok) {
      const status = result.code === 'NOT_LOGGED_IN' ? 403 : 502
      return err(status, result.code, result.message)
    }
    return { status: 200, json: result.models }
  })

  reg.post('/api/bases/:id/install', async (ctx): Promise<Res> => {
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
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
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
    return { status: 200, json: readTierMap(deps.cacheDir, id) }
  })

  reg.put('/api/bases/:id/tiers', async (ctx): Promise<Res> => {
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
    const parsed = tierMapSchema.safeParse(ctx.body ?? {})
    if (!parsed.success) return err(400, 'INVALID_REQUEST', '请求体不合法')
    return { status: 200, json: writeTierMap(deps.cacheDir, id, parsed.data) }
  })

  reg.get('/api/bases/:id/tier-config', async (ctx): Promise<Res> => {
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
    try {
      return { status: 200, json: resolveTierConfig(deps.tierConfigFile, id) }
    } catch (e) {
      return err(500, 'TIER_CONFIG_INVALID', e instanceof Error ? e.message : String(e))
    }
  })

  reg.put('/api/bases/:id/tier-config', async (ctx): Promise<Res> => {
    const id = baseIdFromPath(ctx.path)
    if (!id) return err(404, 'BASE_NOT_FOUND', `未知底座：${ctx.path}`)
    const parsed = tierConfigSchema.safeParse(ctx.body ?? {})
    if (!parsed.success) return err(400, 'INVALID_REQUEST', parsed.error.issues[0]?.message ?? '请求体不合法')
    saveTierConfig(deps.tierConfigFile, id, parsed.data.tiers as Record<TierName, string>)
    return { status: 200, json: resolveTierConfig(deps.tierConfigFile, id) }
  })
}
