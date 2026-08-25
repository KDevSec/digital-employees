import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { JWK } from 'jose'

import { newEs256Jwks } from './crypto.js'


export interface WorkbenchState {
  installationId: string
  privateJwk: JWK
  publicJwk: JWK
  enrollmentId?: string
  workbenchId?: string
  status: 'NEW' | 'PENDING_REVIEW' | 'APPROVED' | 'COMPLETED' | 'ACTIVE' | 'REVOKED' | 'REJECTED' | 'ERROR'
  lastHeartbeatAt?: string
  rejectionReason?: string
  error?: string
}

interface Envelope {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

export class EncryptedStateStore {
  private readonly key: Buffer

  constructor(
    private readonly path: string,
    secret: string,
  ) {
    if (secret.length < 32) throw new Error('WORKBENCH_STATE_SECRET must contain at least 32 characters')
    this.key = scryptSync(secret, 'digital-employees-workbench-state-v1', 32)
  }

  async loadOrCreate(): Promise<WorkbenchState> {
    try {
      return this.decrypt(JSON.parse(await readFile(this.path, 'utf8')) as Envelope)
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      const keys = await newEs256Jwks()
      const state: WorkbenchState = {
        installationId: randomUUID(),
        privateJwk: keys.privateJwk,
        publicJwk: keys.publicJwk,
        status: 'NEW',
      }
      await this.save(state)
      return state
    }
  }

  async save(state: WorkbenchState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(this.encrypt(state)), { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
  }

  private encrypt(state: WorkbenchState): Envelope {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
    return {
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }
  }

  private decrypt(envelope: Envelope): WorkbenchState {
    if (envelope.version !== 1) throw new Error('Unsupported workbench state version')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as WorkbenchState
  }
}
