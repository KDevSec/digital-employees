/**
 * 人员会话存储（A-07；demo sessions 内存 Map → 加密文件持久化，重启免重登）。
 * 单用户多会话并存（多浏览器 cookie 隔离）；过期对齐平台 token 效期（expiresAt），
 * 读取时惰性清理（get 清单条，set 全量清扫——单用户模型条目极少，无需独立 GC）。
 */
import { EncryptedJsonStore } from './encrypted-store'

export interface PersonSession {
  accessToken: string
  /** OIDC id_token 原文（023：RP 登出 id_token_hint 用） */
  idToken?: string
  claims: Record<string, unknown>
  /** 毫秒时刻戳；过期即失效 */
  expiresAt: number
}

type SessionRecord = Record<string, PersonSession>

export class SessionStore {
  private readonly store: EncryptedJsonStore<SessionRecord>

  constructor(path: string, secret: string) {
    this.store = new EncryptedJsonStore<SessionRecord>(path, secret)
  }

  async get(sessionId: string): Promise<PersonSession | undefined> {
    const record = (await this.store.load()) ?? {}
    const session = record[sessionId]
    if (session === undefined) return undefined
    if (session.expiresAt <= Date.now()) {
      delete record[sessionId]
      await this.store.save(record)
      return undefined
    }
    return session
  }

  async set(sessionId: string, session: PersonSession): Promise<void> {
    const record = (await this.store.load()) ?? {}
    for (const [id, s] of Object.entries(record)) {
      if (s.expiresAt <= Date.now()) delete record[id]
    }
    record[sessionId] = session
    await this.store.save(record)
  }

  async delete(sessionId: string): Promise<void> {
    const record = (await this.store.load()) ?? {}
    if (record[sessionId] === undefined) return
    delete record[sessionId]
    await this.store.save(record)
  }
}
