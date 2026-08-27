import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { EnrollmentService } from '../src/app/platform-access/enrollment'
import { MachineTokenManager } from '../src/app/platform-access/machine-token'
import { PlatformError } from '../src/app/platform-access/platform-client'
import { WorkbenchStateStore } from '../src/app/platform-access/state-store'

const SECRET = 'test-secret-that-is-at-least-32-chars'
const PERSON = { accessToken: 'person-token' }

function platformStub(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    discover: vi.fn(async () => ({ machine_token_endpoint: 'http://p/token' })),
    submitEnrollment: vi.fn(async () => ({ id: 'enr-1', status: 'PENDING_REVIEW' })),
    enrollment: vi.fn(async () => ({ status: 'PENDING_REVIEW' })),
    completeEnrollment: vi.fn(async () => 'wb-new-1'),
    machineToken: vi.fn(async () => ({ accessToken: 'mt', expiresInSeconds: 300 })),
    heartbeat: vi.fn(async () => ({ received_at: '2026-08-27T02:00:00Z' })),
    ...overrides,
  }
}

describe('EnrollmentService（demo server.ts 编排迁移）', () => {
  async function setup(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'wb-enrollment-'))
    const stateStore = new WorkbenchStateStore(join(dir, 'state.enc'), SECRET)
    const platform = platformStub(overrides)
    const service = new EnrollmentService({
      stateStore,
      platform: platform as never,
      machineTokens: new MachineTokenManager(),
      installationId: 'install-1111',
    })
    return { stateStore, platform, service }
  }

  it('首次提交：installationId（外部注入）+ 公钥上报，状态 PENDING_REVIEW', async () => {
    const { stateStore, platform, service } = await setup()
    const state = await stateStore.loadOrCreate()
    const enrollment = await service.submitEnrollmentIfNeeded(PERSON, state)
    expect(enrollment).toEqual({ id: 'enr-1', status: 'PENDING_REVIEW' })
    expect(platform.submitEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 'install-1111', publicJwk: state.publicJwk }),
      'person-token',
    )
    expect((await stateStore.loadOrCreate()).status).toBe('PENDING_REVIEW')
  })

  it('已有申请：拉取远端状态同步（COMPLETED + workbenchId → ACTIVE 修复保留）', async () => {
    const { stateStore, service } = await setup({ enrollment: vi.fn(async () => ({ status: 'COMPLETED', workbench_instance_id: 'wb-x' })) })
    const state = await stateStore.loadOrCreate()
    state.enrollmentId = 'enr-1'
    state.workbenchId = 'wb-x'
    state.status = 'ACTIVE'
    await stateStore.save(state)

    await service.submitEnrollmentIfNeeded(PERSON, state)
    expect((await stateStore.loadOrCreate()).status).toBe('ACTIVE') // 不被压回 COMPLETED
  })

  it('已有申请但查询失败 → 重置回 NEW 并重提（自愈路径）', async () => {
    let fail = true
    const { stateStore, platform, service } = await setup({
      enrollment: vi.fn(async () => {
        if (fail) throw new PlatformError(404, 'ENROLLMENT_NOT_FOUND', '没了')
        return { status: 'PENDING_REVIEW' }
      }),
    })
    const state = await stateStore.loadOrCreate()
    state.enrollmentId = 'enr-gone'
    state.status = 'PENDING_REVIEW'
    await stateStore.save(state)

    await service.submitEnrollmentIfNeeded(PERSON, state)
    const after = await stateStore.loadOrCreate()
    expect(after.enrollmentId).toBe('enr-1') // 重新提交拿到新申请
    expect(after.status).toBe('PENDING_REVIEW')
    expect(platform.submitEnrollment).toHaveBeenCalledTimes(1)
    expect(fail).toBe(true) // stub 状态自检
  })

  it('progress：APPROVED → challenge/proof/complete 换 workbenchId → 心跳 ACTIVE', async () => {
    const { stateStore, service } = await setup({ enrollment: vi.fn(async () => ({ status: 'APPROVED' })) })
    const state = await stateStore.loadOrCreate()
    state.enrollmentId = 'enr-1'
    state.status = 'PENDING_REVIEW'
    await stateStore.save(state)

    const result = await service.progress(PERSON)
    expect(result).toEqual({ status: 'ACTIVE', workbenchId: 'wb-new-1' })
    const after = await stateStore.loadOrCreate()
    expect(after.workbenchId).toBe('wb-new-1')
    expect(after.status).toBe('ACTIVE')
    expect(after.lastHeartbeatAt).toBe('2026-08-27T02:00:00Z')
  })

  it('progress：无 enrollmentId → 409 ENROLLMENT_NOT_FOUND', async () => {
    const { service } = await setup()
    const error = (await service.progress(PERSON).catch((e: unknown) => e)) as PlatformError
    expect(error.status).toBe(409)
    expect(error.code).toBe('ENROLLMENT_NOT_FOUND')
  })

  it('progress：PENDING_REVIEW → 只同步状态与拒绝原因，不激活', async () => {
    const { stateStore, service } = await setup({
      enrollment: vi.fn(async () => ({ status: 'PENDING_REVIEW', review_reason: '材料待核' })),
    })
    const state = await stateStore.loadOrCreate()
    state.enrollmentId = 'enr-1'
    await stateStore.save(state)

    const result = await service.progress(PERSON)
    expect(result).toEqual({ status: 'PENDING_REVIEW', review_reason: '材料待核' })
    expect((await stateStore.loadOrCreate()).status).toBe('PENDING_REVIEW')
  })

  it('reset：清五字段保留密钥对（D-am2：同 installationId 重提）', async () => {
    const { stateStore, service } = await setup()
    const state = await stateStore.loadOrCreate()
    state.enrollmentId = 'enr-1'
    state.workbenchId = 'wb-1'
    state.status = 'ACTIVE'
    state.lastHeartbeatAt = '2026-08-27T00:00:00Z'
    state.rejectionReason = 'reason'
    state.error = 'err'
    await stateStore.save(state)

    const result = await service.reset()
    expect(result).toEqual({ status: 'NEW' })
    const after = await stateStore.loadOrCreate()
    expect(after.status).toBe('NEW')
    expect(after.enrollmentId).toBeUndefined()
    expect(after.workbenchId).toBeUndefined()
    expect(after.lastHeartbeatAt).toBeUndefined()
    expect(after.rejectionReason).toBeUndefined()
    expect(after.error).toBeUndefined()
    expect(after.privateJwk).toEqual(state.privateJwk) // 密钥对保留
    expect(after.publicJwk).toEqual(state.publicJwk)
  })
})
