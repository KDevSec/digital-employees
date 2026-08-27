import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmployeeStore, EmployeeIdConflictError } from '../src/employees/store'

/**
 * 员工库 store（Task 8 / B3）：原子落盘 + id 冲突预检 + 失败回滚。
 * - materialize：files 全量写 tmpRoot/<uuid>/ → 校验目标不存在 → rename 到 employeesRoot/<id>/
 * - 路径防御：files[].path 不得含 .. 段、不得以 / 或盘符开头（zip-slip 同款防御）
 * - 失败回滚：任何一步失败清理本次 temp 目录（best-effort）
 * - list：扫描 employeesRoot/<id>/manifest.yml，yaml parse 失败的目录跳过并收集到 invalid
 */

let base: string
let employeesRoot: string
let tmpRoot: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wb-emp-store-'))
  employeesRoot = join(base, 'employees')
  tmpRoot = join(base, 'tmp')
})

describe('createEmployeeStore.exists', () => {
  it('无目录 → false', () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    expect(store.exists('e1')).toBe(false)
  })

  it('materialize 后 → true', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await store.materialize('e1', [{ path: 'manifest.yml', content: 'id: e1\n' }])
    expect(store.exists('e1')).toBe(true)
  })
})

describe('createEmployeeStore.materialize（原子落盘）', () => {
  it('原子落盘：employeesRoot/<id>/ 与全部文件在位（含嵌套 skills/ 路径）', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const files = [
      { path: 'manifest.yml', content: 'id: e1\ndisplay: E1\n' },
      { path: 'AGENTS.md', content: '# E1\n' },
      { path: 'skills/skill-a/SKILL.md', content: '---\nname: skill-a\n---\nbody\n' },
      { path: 'skills/skill-a/references/ref-1.md', content: 'ref content\n' },
    ]
    const { packagePath } = await store.materialize('e1', files)

    expect(packagePath).toBe(join(employeesRoot, 'e1'))
    expect(existsSync(packagePath)).toBe(true)
    expect(readFileSync(join(packagePath, 'manifest.yml'), 'utf8')).toBe('id: e1\ndisplay: E1\n')
    expect(readFileSync(join(packagePath, 'AGENTS.md'), 'utf8')).toBe('# E1\n')
    expect(readFileSync(join(packagePath, 'skills', 'skill-a', 'SKILL.md'), 'utf8'))
      .toBe('---\nname: skill-a\n---\nbody\n')
    expect(readFileSync(join(packagePath, 'skills', 'skill-a', 'references', 'ref-1.md'), 'utf8'))
      .toBe('ref content\n')
  })

  it('同 id 二次 materialize → 抛 EmployeeIdConflictError 且首份内容完好', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await store.materialize('e1', [{ path: 'manifest.yml', content: 'id: e1\n' }])

    await expect(
      store.materialize('e1', [{ path: 'manifest.yml', content: 'id: e1-changed\n' }]),
    ).rejects.toThrow(EmployeeIdConflictError)

    // 首份内容完好（不被半写态污染）
    expect(readFileSync(join(employeesRoot, 'e1', 'manifest.yml'), 'utf8')).toBe('id: e1\n')
  })

  it('files 写中途失败（带 ../escape 的 path）→ 抛错且 tmpRoot 无本次残留、目标目录不存在', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    const files = [
      { path: 'manifest.yml', content: 'id: e1\n' },
      // path traversal —— zip-slip 同款防御
      { path: '../escape.txt', content: 'escape\n' },
    ]

    await expect(store.materialize('e1', files)).rejects.toThrow(/员工包内文件路径不得含/)

    // tmpRoot 无本次残留
    expect(existsSync(tmpRoot)).toBe(true)
    expect(readdirSync(tmpRoot).length).toBe(0)
    // 目标目录不存在（半写态对消费者不可见）
    expect(store.exists('e1')).toBe(false)
  })

  it('绝对路径 / 开头 → 抛错（path 安全校验）', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await expect(
      store.materialize('e1', [{ path: '/etc/passwd', content: 'x\n' }]),
    ).rejects.toThrow(/不得以分隔符开头/)
    expect(readdirSync(tmpRoot).length).toBe(0)
    expect(store.exists('e1')).toBe(false)
  })

  it('盘符开头（C:/x.txt）→ 抛错（path 安全校验）', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await expect(
      store.materialize('e1', [{ path: 'C:/x.txt', content: 'x\n' }]),
    ).rejects.toThrow(/不得以盘符开头/)
    expect(readdirSync(tmpRoot).length).toBe(0)
    expect(store.exists('e1')).toBe(false)
  })

  it('反斜杠绝对路径 \\foo → 抛错', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await expect(
      store.materialize('e1', [{ path: '\\foo.txt', content: 'x\n' }]),
    ).rejects.toThrow(/不得以分隔符开头/)
    expect(readdirSync(tmpRoot).length).toBe(0)
    expect(store.exists('e1')).toBe(false)
  })
})

describe('createEmployeeStore.list（扫描）', () => {
  it('employeesRoot 不存在 → 返回 []，invalid 也为空', () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    expect(store.list()).toEqual([])
    expect(store.invalid).toEqual([])
  })

  it('扫描多个员工 → manifest 内容原样返回（unknown，不过 schema）', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await store.materialize('e1', [{ path: 'manifest.yml', content: 'id: e1\ndisplay: E1\n' }])
    await store.materialize('e2', [{ path: 'manifest.yml', content: 'id: e2\n' }])

    const list = store.list()
    expect(list.length).toBe(2)
    const ids = list.map((x) => x.id).sort()
    expect(ids).toEqual(['e1', 'e2'])

    const e1 = list.find((x) => x.id === 'e1')
    expect(e1?.manifest).toEqual({ id: 'e1', display: 'E1' })
  })

  it('无 manifest.yml 的目录 → 跳过不算 invalid', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await store.materialize('e1', [{ path: 'AGENTS.md', content: 'x\n' }])

    const list = store.list()
    expect(list).toEqual([])
    expect(store.invalid).toEqual([])
  })

  it('坏 yaml 目录进 invalid 跳过，list 不含该 id', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    await store.materialize('good', [{ path: 'manifest.yml', content: 'id: good\n' }])

    // 手工构造坏 yaml 目录（不闭合的引号 → js-yaml load 必抛）
    mkdirSync(join(employeesRoot, 'bad'), { recursive: true })
    writeFileSync(join(employeesRoot, 'bad', 'manifest.yml'), '"unclosed string', 'utf8')

    const list = store.list()
    expect(list.map((x) => x.id)).toEqual(['good'])
    expect(store.invalid).toEqual(['bad'])
  })

  it('list 重置 invalid：第二次扫描仅当前坏 yaml 进 invalid', async () => {
    const store = createEmployeeStore(employeesRoot, tmpRoot)
    mkdirSync(join(employeesRoot, 'bad'), { recursive: true })
    writeFileSync(join(employeesRoot, 'bad', 'manifest.yml'), '"unclosed', 'utf8')

    store.list()
    expect(store.invalid).toEqual(['bad'])

    // 修复 bad → 下次扫描 invalid 应被重置为空
    writeFileSync(join(employeesRoot, 'bad', 'manifest.yml'), 'id: bad\n', 'utf8')
    store.list()
    expect(store.invalid).toEqual([])
  })
})
