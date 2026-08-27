/**
 * 接入状态存储（demo state-store.ts 迁移 + 两处适配，设计 §5.2/偏差 #8）：
 * 1) installationId 不再存 state——service 装配时外部注入 getOrCreateInstallationId(profileDir)
 *    （service.json uid 同源，详设 §6.1「A 系列消费」；demo 自建 ID 的偏差已裁决修正）；
 * 2) 加密层走 EncryptedJsonStore（Task 2），本类只管「首启建密钥对」语义。
 * 八态枚举与 web api/access.ts AccessStatus 契约锁定，不得增删。
 */
import type { JWK } from 'jose'

import { newEs256Jwks } from './crypto'
import { EncryptedJsonStore } from './encrypted-store'

export type EnrollmentStatus =
  | 'NEW'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'COMPLETED'
  | 'ACTIVE'
  | 'REVOKED'
  | 'REJECTED'
  | 'ERROR'

export interface WorkbenchState {
  privateJwk: JWK
  publicJwk: JWK
  enrollmentId?: string
  workbenchId?: string
  status: EnrollmentStatus
  lastHeartbeatAt?: string
  rejectionReason?: string
  error?: string
}

export class WorkbenchStateStore {
  private readonly store: EncryptedJsonStore<WorkbenchState>

  constructor(path: string, secret: string) {
    this.store = new EncryptedJsonStore<WorkbenchState>(path, secret)
  }

  async loadOrCreate(): Promise<WorkbenchState> {
    const existing = await this.store.load()
    if (existing !== undefined) return existing
    const keys = await newEs256Jwks()
    const state: WorkbenchState = {
      privateJwk: keys.privateJwk,
      publicJwk: keys.publicJwk,
      status: 'NEW',
    }
    await this.store.save(state)
    return state
  }

  async save(state: WorkbenchState): Promise<void> {
    await this.store.save(state)
  }
}
