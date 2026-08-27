/**
 * 员工库 store（Task 8 / B3）：原子落盘 + id 冲突预检 + 失败回滚。
 *
 * 落盘管线 E-12 的执行体（注入 employeesRoot/tmpRoot——测试用 tmp，生产 profileDir 派生）。
 *
 * 原子性：files 全量写 tmpRoot/<uuid>/ → 校验目标不存在（存在抛 EmployeeIdConflictError）
 *         → renameSync 到 employeesRoot/<id>/。半写态对外不可见（rename 前目标不存在）。
 * 路径防御：
 *   - id（单段目录名语义）：拒绝空 / "." / ".." / 含 / 或 \ / 盘符前缀——防 targetDir 解析到 employeesRoot 之外
 *   - files[].path（包内相对路径）：不得含 .. 段、不得以 / 或盘符开头（zip-slip 同款防御，防越出员工包目录）
 * 失败回滚：任何一步失败 best-effort 清理本次 temp 目录后抛带具体路径的错误。
 * Windows rename 撞占用：3 attempts（初试 + 2 retries，相邻间隔 100ms），仍败抛错（不静默——12.1 坑表教训）。
 *
 * 目录边界红线：本模块写域止于注入的 employeesRoot/tmpRoot，绝不触碰其他目录。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

export class EmployeeIdConflictError extends Error {
  constructor(public readonly id: string) {
    super(`员工 ID 已存在：${id}`)
    this.name = 'EmployeeIdConflictError'
  }
}

const RE_DRIVE_LETTER = /^[a-zA-Z]:/

/** 员工 ID 安全校验谓词（非抛错式）：单段目录名语义（拒空 / "." / ".." / 含分隔符 / 盘符前缀）。
 *  路由回退 join employeesRoot 前的预检复用——installs 域实时探查员工库时防越界（终审 B1）。 */
export function isSafeEmployeeId(id: string): boolean {
  if (id === '' || id === '.' || id === '..') return false
  if (id.includes('/') || id.includes('\\')) return false
  if (RE_DRIVE_LETTER.test(id)) return false
  return true
}

/** 员工 ID 安全校验（抛错式——store 内部用，错误带具体原因；与 isSafeEmployeeId 同判据） */
function validateId(id: string): void {
  if (id === '') {
    throw new Error(`员工 ID 不得为空`)
  }
  if (id === '.' || id === '..') {
    throw new Error(`员工 ID 不得为 "." 或 ".."：${id}`)
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`员工 ID 不得含路径分隔符：${id}`)
  }
  if (RE_DRIVE_LETTER.test(id)) {
    throw new Error(`员工 ID 不得以盘符开头：${id}`)
  }
}

/** 员工包内文件路径安全校验：仅允许相对路径，禁绝对/盘符/.. 段（zip-slip 同款防御） */
function validateRelPath(p: string): void {
  if (p === '') {
    throw new Error(`员工包内文件路径不得为空`)
  }
  if (p.startsWith('/') || p.startsWith('\\')) {
    throw new Error(`员工包内文件路径不得以分隔符开头：${p}`)
  }
  if (RE_DRIVE_LETTER.test(p)) {
    throw new Error(`员工包内文件路径不得以盘符开头：${p}`)
  }
  const segments = p.split(/[/\\]/)
  if (segments.some((s) => s === '..')) {
    throw new Error(`员工包内文件路径不得含 ".." 段：${p}`)
  }
}

/** Windows rename 撞占用时 3 attempts（初试 + 2 retries，相邻间隔 100ms），仍败抛错（不静默） */
async function renameWithRetry(src: string, dest: string): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      renameSync(src, dest)
      return
    } catch (err) {
      lastErr = err
      if (attempt < 3) {
        await new Promise<void>((r) => setTimeout(r, 100))
      }
    }
  }
  throw new Error(`原子 rename 失败（3 attempts，相邻间隔 100ms 仍败）src=${src} dest=${dest}`, {
    cause: lastErr,
  })
}

/**
 * 创建员工库 store。两根目录注入——测试用 tmp，生产 profileDir 派生。
 * 目录边界：写域止于注入的两根目录。
 */
export function createEmployeeStore(employeesRoot: string, tmpRoot: string) {
  /** 最近一次 list() 扫描收集到的坏 yaml 目录 id 列表（每次 list 重新置空后填充） */
  let invalid: string[] = []

  return {
    /** employeesRoot/<id>/ 是否存在（id 安全校验：拒越界 id） */
    exists(id: string): boolean {
      validateId(id)
      return existsSync(join(employeesRoot, id))
    },

    /**
     * 原子落盘：files 全量写 tmpRoot/<uuid>/ → 校验目标不存在（存在抛 EmployeeIdConflictError）
     * → renameSync 到 employeesRoot/<id>/ → 返回 { packagePath }
     * 任何一步失败：清理本次 temp 目录（best-effort）后抛带具体路径的错误。
     * id 安全校验先于任何 IO（拒越界 id，防 rename 把 tmpDir 搬到员工库外）。
     */
    async materialize(
      id: string,
      files: Array<{ path: string; content: string }>,
    ): Promise<{ packagePath: string }> {
      validateId(id)

      const sessionId = randomUUID()
      const tmpDir = join(tmpRoot, sessionId)
      mkdirSync(tmpDir, { recursive: true })

      const cleanup = (): void => {
        try {
          rmSync(tmpDir, { recursive: true, force: true })
        } catch {
          // best-effort：清理失败不掩盖原错误
        }
      }

      try {
        // Step 1: 全量写入 tmpDir/<uuid>/（path 安全校验逐条先于写）
        for (const f of files) {
          validateRelPath(f.path)
          const filePath = join(tmpDir, f.path)
          mkdirSync(dirname(filePath), { recursive: true })
          writeFileSync(filePath, f.content, 'utf8')
        }

        // Step 2: 校验目标不存在（rename 前预检；抛 EmployeeIdConflictError 触发 cleanup）
        const targetDir = join(employeesRoot, id)
        if (existsSync(targetDir)) {
          throw new EmployeeIdConflictError(id)
        }

        // Step 3: rename tmpDir → employeesRoot/<id>/（确保父目录存在 + Windows 重试）
        mkdirSync(employeesRoot, { recursive: true })
        await renameWithRetry(tmpDir, targetDir)

        return { packagePath: targetDir }
      } catch (err) {
        cleanup()
        throw err
      }
    },

    /**
     * 扫描 employeesRoot/<id>/manifest.yml；yaml parse 失败的目录跳过并收集 id 到 invalid。
     * employeesRoot 不存在 → 返回 []。无 manifest.yml 的目录跳过不算 invalid。
     * manifest 内容原样返回（unknown——不在此处过 schema，scanner 端点任务再做）。
     */
    list(): Array<{ id: string; manifest: unknown }> {
      invalid = []
      if (!existsSync(employeesRoot)) return []

      const out: Array<{ id: string; manifest: unknown }> = []
      for (const entry of readdirSync(employeesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const id = entry.name
        const manifestPath = join(employeesRoot, id, 'manifest.yml')
        if (!existsSync(manifestPath)) continue // 无 manifest.yml 不算 invalid
        try {
          const text = readFileSync(manifestPath, 'utf8')
          const doc: unknown = yaml.load(text)
          out.push({ id, manifest: doc })
        } catch {
          invalid.push(id)
        }
      }
      return out
    },

    /** 最近一次 list() 收集的坏 yaml 目录 id（list 前为空数组） */
    get invalid(): string[] {
      return invalid
    },
  }
}
