/**
 * 通用加密 JSON 存储（A-06；demo state-store.ts 加密层泛化）。
 * AES-256-GCM（信封 version 1：iv/tag/ciphertext base64url）+ scrypt 派生密钥（盐沿用 demo，
 * 密钥串 ≥32 字符校验）；原子写（tmp + rename，0600/目录 0700）。
 * load：ENOENT → undefined；损坏（解密失败/坏 JSON/版本不符）→ 抛错——「无文件」与「坏文件」必须可区分。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * rename 重试退避（毫秒）。Windows 上目标文件被杀毒实时扫描/另一进程句柄短暂占用时，
 * MoveFileEx 返回 EPERM/EACCES/EBUSY/EEXIST——稍候重试即可成功（026 实测故障）。
 */
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160] as const
const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 带退避重试的 rename（仅对 Windows 句柄占用类瞬时错误重试，其他错误立即抛）。 */
async function renameWithRetry(
  from: string,
  to: string,
  doRename: typeof rename = rename,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await doRename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (!code || !RENAME_RETRYABLE.has(code) || attempt === RENAME_RETRY_DELAYS_MS.length) break
      await sleep(RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
  throw lastError
}

interface Envelope {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

const SCRYPT_SALT = 'digital-employees-workbench-state-v1'

export class EncryptedJsonStore<T> {
  private readonly key: Buffer
  /** 进程内写队列（026）：并发 save 串行落盘，避免 tmp/rename 交错；后写为准。 */
  private writeChain: Promise<void> = Promise.resolve()
  /** 临时文件名序号（与 pid 组合，跨进程/同进程并发均不撞名）。 */
  private tmpSequence = 0

  constructor(
    private readonly path: string,
    secret: string,
    /** 测试注入缝（026）：可替换 rename 以模拟 Windows EPERM 重试；默认走 fs/promises。 */
    private readonly deps: { rename?: typeof rename } = {},
  ) {
    if (secret.length < 32) throw new Error('加密密钥至少 32 字符（A-06：首启随机生成，不接受短密钥）')
    this.key = scryptSync(secret, SCRYPT_SALT, 32)
  }

  async load(): Promise<T | undefined> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      return undefined
    }
    return this.decrypt(JSON.parse(raw) as Envelope)
  }

  async save(value: T): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow(value))
    // 队列本身不因单次失败而断裂（失败经 run 抛给调用方）
    this.writeChain = run.catch(() => undefined)
    await run
  }

  private async writeNow(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    // 026：唯一临时名（pid+单调序号）——daemon 与托盘服务多进程并存、同进程并发保存时
    // 互不覆盖/互争同一 tmp（Windows 固定 .tmp 名是 EPERM 的直接诱因之一）。
    this.tmpSequence += 1
    const temporary = `${this.path}.tmp.${process.pid}.${this.tmpSequence}`
    try {
      await writeFile(temporary, JSON.stringify(this.encrypt(value)), { mode: 0o600 })
      await chmod(temporary, 0o600)
      await renameWithRetry(temporary, this.path, this.deps.rename)
    } finally {
      // 无论成败都尝试清理自己的 tmp（rename 成功后 unlink ENOENT 忽略；失败留手不抛）。
      await unlink(temporary).catch(() => undefined)
    }
  }

  private encrypt(value: T): Envelope {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return {
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }
  }

  private decrypt(envelope: Envelope): T {
    if (envelope.version !== 1) throw new Error('Unsupported encrypted store version')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as T
  }
}
