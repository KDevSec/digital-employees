/**
 * builder 管线八步（Task 11 / B6 / E-12 编排层）。
 *
 * 把校验/渲染/物化/编译串成八步管线，输入 EmployeeDraft（向导产物）→ 输出落盘的员工包。
 *
 * 管线八步（generate 内序）：
 *   1. validateManifest(draft.manifest) —— 不合法抛 DraftValidationError（携带 issues 供路由 422）
 *   2. 渲染 AGENTS.md：renderAgentsMd(manifest, skills)
 *   3. manifest.yml 文本：yaml.dump(manifest)（注入 template_id：draft.skills 模板来源条目
 *      若 manifest.skills 同名条目无 template_id 且素材在模板 `<tplId>` 位 —— 用素材实际所在模板 id 注入）
 *   4. skills 物化：template 来源 → builtinTemplates 遍历 `<*>/skills/<name>/...` 前缀键 + custom fs 扫描；
 *      local 来源 → tmpRoot/skills/<name>/ 目录读取（缺失抛 SkillMissingError）
 *   5. hooks.json：compileHooks(manifest)（非 null 则入 files）；红线脚本本体 copyRedlineScripts
 *      （builtinTemplates 含 `<tplId>/hooks/redlines/` 键时逐文件拷入包内 hooks/redlines/；当前无该键则跳过）
 *   6. mcp.json：manifest.connectors 非空才生成 `{ mcpServers: { [name]: { type, command?, args?, url?, env } } }`
 *   7. orchestration：manifest.orchestration 存在 → 从模板位拷该 yml（builtinTemplates 键或 custom fs）
 *   8. store.materialize(manifest.id, [...全部 files]) → { package_path }；返回 { package_path, files, manifest }
 *
 * 目录边界：本模块写域止于注入的 store（store 内部止于 employeesRoot/tmpRoot），不触碰其他目录。
 * provider 只读（builtin 内存 + custom fs 读），不写。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type {
  Manifest,
  SkillEntry,
  ValidationIssue,
} from '@devzero/shared-protocol'
import { validateManifest } from '@devzero/shared-protocol'
import { builtinTemplates } from '../assets/templates.gen'
import type { TemplatesProvider } from '../templates/provider'
import { renderAgentsMd } from './renderer'
import { compileHooks } from './hooks-compiler'

/** 向导 draft：完整 manifest 值 + skills 附素材描述 */
export interface EmployeeDraft {
  manifest: Manifest
  skills: Array<{
    name: string
    version: string
    source_type: 'template' | 'local'
    template_id?: string
    origin?: string
    description: string
  }>
}

/** skill 素材缺失（local 上传目录不存在 / template 找不到素材） */
export class SkillMissingError extends Error {
  constructor(public readonly name: string) {
    super(`skill 素材缺失，需重新上传：${name}`)
    this.name = 'SkillMissingError'
  }
}

/** draft 校验失败：携带 issues 供路由 422 逐项 step 定位 */
export class DraftValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`manifest 校验失败：${issues.length} 项`)
    this.name = 'DraftValidationError'
  }
}

export interface GenerateResult {
  package_path: string
  files: string[]
  manifest: Manifest
}

export interface BuilderDeps {
  provider: TemplatesProvider
  store: ReturnType<typeof createEmployeeStore>
  tmpRoot: string
}

// 仅引入 store 的类型（运行时不依赖本文件做 store 实例化）
import type { createEmployeeStore } from './store'

/** 包内文件（path 相对员工包根 + content 文本） */
interface PackFile {
  path: string
  content: string
}

/**
 * 创建 builder。八步管线在 generate 内序；任何步骤失败抛出语义错误（路由层映射 HTTP 状态）。
 */
export function createEmployeeBuilder(deps: BuilderDeps) {
  const { provider, store, tmpRoot } = deps

  return {
    async generate(draft: EmployeeDraft): Promise<GenerateResult> {
      // 步 1：validateManifest
      const r = validateManifest(draft.manifest)
      if (!r.valid) {
        throw new DraftValidationError(r.issues)
      }

      // 深拷贝 manifest 用于注入 template_id（避免污染入参）
      const manifest: Manifest = JSON.parse(JSON.stringify(draft.manifest))

      // 步 3a：template_id 注入（在 yaml.dump 前）
      injectTemplateIds(manifest, draft, provider)

      const files: PackFile[] = []

      // 步 2：渲染 AGENTS.md
      files.push({ path: 'AGENTS.md', content: renderAgentsMd(manifest, draft.skills) })

      // 步 3b：manifest.yml 文本
      files.push({ path: 'manifest.yml', content: yaml.dump(manifest, { lineWidth: -1 }) })

      // 步 4：skills 物化
      for (const skillEntry of manifest.skills) {
        const skillFiles = materializeSkill(skillEntry, draft, provider, tmpRoot)
        files.push(...skillFiles)
      }

      // 步 5：hooks.json + redlines 脚本本体
      const hooksText = compileHooks(manifest)
      if (hooksText !== null) {
        files.push({ path: 'hooks/hooks.json', content: hooksText })
      }
      copyRedlineScripts(manifest, draft, provider, files)

      // 步 6：mcp.json（connectors 非空才生成）
      if (manifest.connectors.length > 0) {
        files.push({ path: 'mcp.json', content: buildMcpJson(manifest) })
      }

      // 步 7：orchestration 拷贝
      if (manifest.orchestration) {
        const orchFile = materializeOrchestration(manifest, draft, provider)
        if (orchFile !== null) {
          files.push(orchFile)
        }
      }

      // 步 8：store.materialize（原子落盘）
      const { packagePath } = await store.materialize(manifest.id, files)

      return {
        package_path: packagePath,
        files: files.map((f) => f.path),
        manifest,
      }
    },
  }
}

// ---------- 步 3a：template_id 注入 ----------

/**
 * 注入 template_id：draft.skills 的 template 来源条目若 manifest.skills 同名条目无 template_id
 * 且素材在模板 `<tplId>` 位 —— 用素材实际所在模板 id 注入。
 *
 * tplId 取值优先级：
 *   1. draft.skills[].template_id（向导已指定素材来源模板）
 *   2. 扫描 builtinTemplates + custom fs 找 `<*>/skills/<name>/` 唯一所在模板 id
 *
 * 同源约束：注入的 template_id 与步 4 物化时定位的模板 id 同源（同一函数解析）。
 */
function injectTemplateIds(manifest: Manifest, draft: EmployeeDraft, provider: TemplatesProvider): void {
  for (const draftSkill of draft.skills) {
    if (draftSkill.source_type !== 'template') continue
    const mSkill = manifest.skills.find((s) => s.name === draftSkill.name)
    if (!mSkill) continue
    if (mSkill.source_type !== 'template') continue
    if (mSkill.template_id) continue // 已有不动
    const tplId = resolveTemplateId(draftSkill, provider)
    if (tplId) {
      mSkill.template_id = tplId
    }
  }
}

/**
 * 解析素材所在模板 id（template 来源 skill）：
 *   1. draft.skills[].template_id（向导指定）
 *   2. builtinTemplates 扫描 `<*>/skills/<name>/` 唯一所在模板
 *   3. custom fs 扫描 provider.customRoot/<*>/skills/<name>/SKILL.md
 */
function resolveTemplateId(
  draftSkill: { name: string; template_id?: string },
  provider: TemplatesProvider,
): string | undefined {
  // 1. draft 显式指定
  if (draftSkill.template_id) {
    if (skillMaterialExists(draftSkill.template_id, draftSkill.name, provider)) {
      return draftSkill.template_id
    }
    return undefined
  }
  // 2. builtin 扫描
  const builtinTpl = findBuiltinTemplateIdForSkill(draftSkill.name)
  if (builtinTpl) return builtinTpl
  // 3. custom fs 扫描
  return findCustomTemplateIdForSkill(draftSkill.name, provider)
}

/** 检查 skill 素材是否存在于模板位（builtinTemplates 键或 custom fs） */
function skillMaterialExists(tplId: string, skillName: string, provider: TemplatesProvider): boolean {
  // builtin 内存：任意 `<tplId>/skills/<skillName>/...` 键
  const prefix = `${tplId}/skills/${skillName}/`
  for (const key of Object.keys(builtinTemplates)) {
    if (key.startsWith(prefix)) return true
  }
  // custom fs：provider.customRoot/<tplId>/skills/<skillName>/SKILL.md 至少存在
  const skillMdRel = `${tplId}/skills/${skillName}/SKILL.md`
  if (providerRead(provider, skillMdRel) !== null) return true
  return false
}

/** 扫描 builtinTemplates 找 `<*>/skills/<skillName>/` 唯一所在模板 id（多模板同名取首见字典序） */
function findBuiltinTemplateIdForSkill(skillName: string): string | undefined {
  const prefix = `/skills/${skillName}/`
  const found: string[] = []
  for (const key of Object.keys(builtinTemplates)) {
    const idx = key.indexOf(prefix)
    if (idx > 0) {
      const tplId = key.slice(0, idx)
      // 确保 tplId 是单段（不含 /，避免误匹配嵌套路径）
      if (!tplId.includes('/')) found.push(tplId)
    }
  }
  if (found.length === 0) return undefined
  // 字典序首见（稳定；多模板同 skill 名由消费方决策，本扫描给兜底）
  return [...new Set(found)].sort()[0]
}

/** 扫描 custom fs 找 `<*>/skills/<skillName>/SKILL.md` 所在模板 id */
function findCustomTemplateIdForSkill(skillName: string, provider: TemplatesProvider): string | undefined {
  if (!existsSync(provider.customRoot)) return undefined
  let entries: string[] = []
  try {
    entries = readdirSync(provider.customRoot)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const skillMd = join(provider.customRoot, entry, 'skills', skillName, 'SKILL.md')
    if (existsSync(skillMd)) return entry
  }
  return undefined
}

// ---------- 步 4：skills 物化 ----------

/**
 * 物化单条 skill：
 * - template 来源：素材按 name 在 builtin（builtinTemplates 遍历 `<*>/skills/<name>/` 前缀键）
 *   或 custom（provider.customRoot/<tplId>/skills/<name>/）定位 —— 全部文件转为 {path: 'skills/<name>/<相对>', content}
 * - local 来源：tmpRoot/skills/<name>/ 目录读取（不存在抛 SkillMissingError）
 */
function materializeSkill(
  skill: SkillEntry,
  draft: EmployeeDraft,
  provider: TemplatesProvider,
  tmpRoot: string,
): PackFile[] {
  if (skill.source_type === 'template') {
    return materializeTemplateSkill(skill, draft, provider)
  }
  return materializeLocalSkill(skill, tmpRoot)
}

/** template 来源 skill 物化：定位素材所在模板 → 全部文件转 PackFile */
function materializeTemplateSkill(
  skill: SkillEntry,
  draft: EmployeeDraft,
  provider: TemplatesProvider,
): PackFile[] {
  if (skill.source_type !== 'template') {
    throw new Error(`skill ${skill.name} source_type 非 template`)
  }
  // tplId 取值优先级与注入同源：manifest.skills 条目 template_id（已注入） → draft.skills 条目 template_id → 扫描兜底
  const draftSkill = draft.skills.find((s) => s.name === skill.name && s.source_type === 'template')
  const tplId = skill.template_id
    ?? draftSkill?.template_id
    ?? resolveTemplateId(draftSkill ?? { name: skill.name }, provider)

  if (!tplId) {
    throw new SkillMissingError(skill.name)
  }

  const files: PackFile[] = []
  // builtin 遍历 `<tplId>/skills/<skill.name>/...` 前缀键
  const prefix = `${tplId}/skills/${skill.name}/`
  let foundInBuiltin = false
  for (const key of Object.keys(builtinTemplates)) {
    if (!key.startsWith(prefix)) continue
    foundInBuiltin = true
    const rel = key.slice(prefix.length) // skills/<name>/ 之后的部分
    files.push({
      path: `skills/${skill.name}/${rel}`,
      content: builtinTemplates[key]!,
    })
  }
  if (foundInBuiltin) return files

  // custom fs 扫描 provider.customRoot/<tplId>/skills/<skill.name>/
  const customSkillDir = join(provider.customRoot, tplId, 'skills', skill.name)
  if (existsSync(customSkillDir) && statSync(customSkillDir).isDirectory()) {
    walkDir(customSkillDir, (abs, rel) => {
      files.push({
        path: `skills/${skill.name}/${rel}`,
        content: readFileSync(abs, 'utf8'),
      })
    })
    if (files.length > 0) return files
  }

  throw new SkillMissingError(skill.name)
}

/** local 来源 skill 物化：从 tmpRoot/skills/<name>/ 读全部文件（不存在抛 SkillMissingError） */
function materializeLocalSkill(skill: SkillEntry, tmpRoot: string): PackFile[] {
  if (skill.source_type !== 'local') {
    throw new Error(`skill ${skill.name} source_type 非 local`)
  }
  const localDir = join(tmpRoot, 'skills', skill.name)
  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    throw new SkillMissingError(skill.name)
  }
  const files: PackFile[] = []
  walkDir(localDir, (abs, rel) => {
    files.push({
      path: `skills/${skill.name}/${rel}`,
      content: readFileSync(abs, 'utf8'),
    })
  })
  if (files.length === 0) {
    throw new SkillMissingError(skill.name)
  }
  return files
}

// ---------- 步 5：redlines 脚本本体拷贝 ----------

/**
 * 红线脚本本体拷贝（copyRedlineScripts）：
 * draft 模板源若在 builtinTemplates 有 `<tplId>/hooks/redlines/` 键（D3 物化后自然生效），
 * 逐文件拷入包内 `hooks/redlines/`；当前无该键则跳过（接口留好）。
 *
 * 模板位取值：取 draft.skills 所有 template 来源条目 template_id 去重 → 逐 tplId 试 `read('<tplId>/hooks/redlines/<file>')`。
 */
function copyRedlineScripts(
  _manifest: Manifest,
  draft: EmployeeDraft,
  provider: TemplatesProvider,
  files: PackFile[],
): void {
  const tplIds = new Set<string>()
  for (const ds of draft.skills) {
    if (ds.source_type === 'template' && ds.template_id) {
      tplIds.add(ds.template_id)
    }
  }
  for (const tplId of tplIds) {
    const prefix = `${tplId}/hooks/redlines/`
    // builtin 遍历
    for (const key of Object.keys(builtinTemplates)) {
      if (!key.startsWith(prefix)) continue
      const rel = key.slice(prefix.length)
      files.push({
        path: `hooks/redlines/${rel}`,
        content: builtinTemplates[key]!,
      })
    }
    // custom fs 扫描（保险：builtin 未命中才扫 fs）
    if (files.some((f) => f.path.startsWith('hooks/redlines/'))) continue
    const customRedlinesDir = join(provider.customRoot, tplId, 'hooks', 'redlines')
    if (existsSync(customRedlinesDir) && statSync(customRedlinesDir).isDirectory()) {
      walkDir(customRedlinesDir, (abs, rel) => {
        files.push({
          path: `hooks/redlines/${rel}`,
          content: readFileSync(abs, 'utf8'),
        })
      })
    }
  }
}

// ---------- 步 6：mcp.json ----------

/**
 * mcp.json 文本：`{ mcpServers: { [name]: { type, command?, args?, url?, env } } }`
 * 仅当 manifest.connectors 非空才生成。
 */
function buildMcpJson(manifest: Manifest): string {
  const mcpServers: Record<string, unknown> = {}
  for (const c of manifest.connectors) {
    const entry: Record<string, unknown> = { type: c.type }
    if (c.command !== undefined) entry.command = c.command
    if (c.args.length > 0) entry.args = c.args
    if (c.url) entry.url = c.url
    entry.env = c.env
    mcpServers[c.name] = entry
  }
  return JSON.stringify({ mcpServers }, null, 2)
}

// ---------- 步 7：orchestration 拷贝 ----------

/**
 * orchestration 拷贝：manifest.orchestration.node_table 形如 'orchestration/dev-engineer.node-table.yml'。
 * 从模板位拷该 yml —— builtinTemplates 键（`<tplId>/orchestration/<file>`）或 custom fs。
 * 模板位取值：取 draft.skills 所有 template 来源条目 template_id 去重 → 逐 tplId 试读。
 */
function materializeOrchestration(
  manifest: Manifest,
  draft: EmployeeDraft,
  provider: TemplatesProvider,
): PackFile | null {
  const nodeTable = manifest.orchestration?.node_table
  if (!nodeTable) return null
  // node_table 形如 'orchestration/dev-engineer.node-table.yml'，剥前缀 'orchestration/' 取文件名
  const fileInPkg = nodeTable
  const orchFile = fileInPkg.startsWith('orchestration/') ? fileInPkg.slice('orchestration/'.length) : fileInPkg

  const tplIds = new Set<string>()
  for (const ds of draft.skills) {
    if (ds.source_type === 'template' && ds.template_id) {
      tplIds.add(ds.template_id)
    }
  }
  // 兜底：若 draft 无 template 来源（极端用例），尝试 manifest.id 作为模板位
  tplIds.add(manifest.id)

  for (const tplId of tplIds) {
    const rel = `${tplId}/orchestration/${orchFile}`
    const text = providerRead(provider, rel)
    if (text !== null) {
      return { path: fileInPkg, content: text }
    }
  }
  return null
}

// ---------- 内部辅助 ----------

/** provider.read 包装：捕获异常归一 null（与 provider 契约一致——不存在/异常均 null） */
function providerRead(provider: TemplatesProvider, relPath: string): string | null {
  try {
    return provider.read(relPath)
  } catch {
    return null
  }
}

/** 递归遍历目录，回调 (abs, rel)，rel 用 forward slash（包内路径统一 /） */
function walkDir(root: string, cb: (abs: string, rel: string) => void): void {
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = join(root, entry)
    let isDir = false
    let isFile = false
    try {
      const s = statSync(abs)
      isDir = s.isDirectory()
      isFile = s.isFile()
    } catch {
      continue
    }
    if (isDir) {
      walkDir(abs, (a, r) => cb(a, `${entry}/${r}`))
    } else if (isFile) {
      cb(abs, entry)
    }
  }
}
