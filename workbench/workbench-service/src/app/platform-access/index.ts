/**
 * platform-access 装配（main.ts 唯一入口）：auth-secret → stores → platform →
 * config-cache → flows → machineTokens → enrollment → service + scheduler。
 */
import { join } from 'node:path'

import type { WorkbenchConfig } from '../../config/schema'
import { loadOrCreateAuthSecret } from './auth-secret'
import { PlatformConfigCache } from './config-cache'
import { EnrollmentService } from './enrollment'
import { HeartbeatScheduler } from './heartbeat'
import { MachineTokenManager } from './machine-token'
import { OidcFlowStore } from './oidc'
import { PlatformClient } from './platform-client'
import { PlatformAccessService } from './service'
import { SessionStore } from './session-store'
import { WorkbenchStateStore } from './state-store'

export interface PlatformAccessOptions {
  profileDir: string
  loadConfig: (profileDir: string) => WorkbenchConfig
  installationId: string
  version: string
}

export interface PlatformAccess {
  service: PlatformAccessService
  scheduler: HeartbeatScheduler
}

export function createPlatformAccess(options: PlatformAccessOptions): PlatformAccess {
  const authDir = join(options.profileDir, 'auth')
  const secret = loadOrCreateAuthSecret(authDir)
  const stateStore = new WorkbenchStateStore(join(authDir, 'state.enc'), secret)
  const sessionStore = new SessionStore(join(authDir, 'sessions.enc'), secret)
  const platform = new PlatformClient({
    getBaseUrl: () => options.loadConfig(options.profileDir).platform.baseUrl,
    version: options.version,
  })
  const configCache = new PlatformConfigCache(authDir)
  const flows = new OidcFlowStore()
  const machineTokens = new MachineTokenManager()
  const enrollment = new EnrollmentService({ stateStore, platform, machineTokens, installationId: options.installationId })
  const service = new PlatformAccessService({
    profileDir: options.profileDir,
    loadConfig: options.loadConfig,
    installationId: options.installationId,
    stateStore,
    sessionStore,
    platform,
    configCache,
    flows,
    enrollment,
  })
  const scheduler = new HeartbeatScheduler({ stateStore, platform, machineTokens })
  return { service, scheduler }
}
