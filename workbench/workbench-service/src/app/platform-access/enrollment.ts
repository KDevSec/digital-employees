/**
 * 接入编排（A-03/A-04；demo server.ts 的 submitEnrollmentIfNeeded/acquireAndHeartbeat/progress/reset
 * 迁移，设计 §5.6）。installationId 经构造注入（profile 同源）；机器 token 走管理器缓存。
 */
import type { MachineTokenManager } from './machine-token'
import type { PlatformClient } from './platform-client'
import { PlatformError } from './platform-client'
import type { WorkbenchState, WorkbenchStateStore } from './state-store'

export interface PersonCredential {
  accessToken: string
}

export interface EnrollmentDeps {
  stateStore: WorkbenchStateStore
  platform: PlatformClient
  machineTokens: MachineTokenManager
  /** 装机稳定 ID（profile/installation-id 同源，service.json uid 一致） */
  installationId: string
}

export class EnrollmentService {
  constructor(private readonly deps: EnrollmentDeps) {}

  async submitEnrollmentIfNeeded(
    person: PersonCredential,
    state: WorkbenchState,
  ): Promise<{ id: string; status: string } | undefined> {
    if (state.enrollmentId && !['REJECTED', 'ERROR'].includes(state.status)) {
      try {
        const existing = await this.deps.platform.enrollment(state.enrollmentId, person.accessToken)
        // 修复（验收阻塞，2026-08-26）：申请表终态 COMPLETED ≠ 实例未激活——已换得 workbenchId
        // 的实例应保持 ACTIVE（心跳态）；原样覆盖会把已激活实例在每次拉状态时压回「已完成注册」，
        // 前端守卫据此判非 ACTIVE 不自动跳转、状态卡恒示「能力已锁定」（demo 单 status 字段
        // 混用申请/实例两张表状态的 bug，正式 A 系列迁移时两态分离）。
        if (existing.status === 'COMPLETED' && state.workbenchId) {
          state.status = 'ACTIVE'
        } else {
          state.status = existing.status as WorkbenchState['status']
        }
        await this.deps.stateStore.save(state)
        return undefined
      } catch {
        state.enrollmentId = undefined
        state.workbenchId = undefined
        state.status = 'NEW'
        state.lastHeartbeatAt = undefined
        state.rejectionReason = undefined
        state.error = undefined
        await this.deps.stateStore.save(state)
      }
    }
    const enrollment = await this.deps.platform.submitEnrollment(
      { installationId: this.deps.installationId, publicJwk: state.publicJwk },
      person.accessToken,
    )
    state.enrollmentId = enrollment.id
    state.status = enrollment.status as WorkbenchState['status']
    state.rejectionReason = undefined
    state.error = undefined
    await this.deps.stateStore.save(state)
    return enrollment
  }

  async acquireAndHeartbeat(state: WorkbenchState): Promise<void> {
    if (!state.workbenchId) throw new Error('终端尚未完成接入激活')
    const configuration = await this.deps.platform.discover()
    const token = await this.deps.machineTokens.get({
      workbenchId: state.workbenchId,
      privateJwk: state.privateJwk,
      tokenEndpoint: configuration.machine_token_endpoint,
      platform: this.deps.platform,
    })
    const result = await this.deps.platform.heartbeat(state.workbenchId, token)
    state.lastHeartbeatAt = result.received_at
    state.status = 'ACTIVE'
    await this.deps.stateStore.save(state)
  }

  async progress(person: PersonCredential): Promise<{ status: string; workbenchId?: string; review_reason?: string }> {
    const state = await this.deps.stateStore.loadOrCreate()
    if (!state.enrollmentId) throw new PlatformError(409, 'ENROLLMENT_NOT_FOUND', '请先提交接入申请')
    const enrollment = await this.deps.platform.enrollment(state.enrollmentId, person.accessToken)
    state.status = enrollment.status as WorkbenchState['status']
    state.rejectionReason = enrollment.review_reason
    if (enrollment.status === 'APPROVED') {
      state.workbenchId = await this.deps.platform.completeEnrollment(
        {
          enrollmentId: state.enrollmentId,
          privateJwk: state.privateJwk,
          installationId: this.deps.installationId,
        },
        person.accessToken,
      )
    } else if (enrollment.status === 'COMPLETED' && enrollment.workbench_instance_id) {
      state.workbenchId = enrollment.workbench_instance_id
    } else {
      await this.deps.stateStore.save(state)
      return { status: enrollment.status, review_reason: enrollment.review_reason }
    }
    await this.acquireAndHeartbeat(state)
    return { status: state.status, workbenchId: state.workbenchId }
  }

  async reset(): Promise<{ status: 'NEW' }> {
    const state = await this.deps.stateStore.loadOrCreate()
    state.enrollmentId = undefined
    state.workbenchId = undefined
    state.status = 'NEW'
    state.lastHeartbeatAt = undefined
    state.rejectionReason = undefined
    state.error = undefined
    await this.deps.stateStore.save(state)
    return { status: 'NEW' }
  }
}
