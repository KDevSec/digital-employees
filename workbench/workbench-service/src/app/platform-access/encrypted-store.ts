/**
 * 通用加密 JSON 存储（A-06；demo state-store.ts 加密层泛化）。
 * AES-256-GCM（信封 version 1：iv/tag/ciphertext base64url）+ scrypt 派生密钥（盐沿用 demo，
 * 密钥串 ≥32 字符校验）；原子写（tmp + rename，0600/目录 0700）。
 * load：ENOENT → undefined；损坏（解密失败/坏 JSON/版本不符）→ 抛错——「无文件」与「坏文件」必须可区分。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface Envelope {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

const SCRYPT_SALT = 'digital-employees-workbench-state-v1'

export class EncryptedJsonStore<T> {
  private readonly key: Buffer

  constructor(
    private readonly path: string,
    secret: string,
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
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(this.encrypt(value)), { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
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
