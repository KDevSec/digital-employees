/**
 * platform-access 门面（A 系列八端点的 handler 逻辑；demo server.ts 各 handler 迁移）。
 * 全部方法不抛异常：异常经 run() 归一为 Res（demo 错误中间件语义）。
 * 开发环境语义（D-049 同一判据 schema.isDevEnvironment）贯穿：state 注入开发态、
 * login/动作端点 503 PLATFORM_NOT_CONFIGURED、guard 全放行。
 */
import { randomUUID } from 'node:crypto'

import { isDevEnvironment } from '../../config/schema'
import type { WorkbenchConfig } from '../../config/schema'
import type { AuthGrade, Ctx, Res } from '../../server/registry'
import { createPkce } from './crypto'
import { cacheMatchesConfig, PlatformConfigCache } from './config-cache'
import { EnrollmentService } from './enrollment'
import { PlatformError } from './platform-client'
import type { PlatformClient, WorkbenchConfiguration } from './platform-client'
import { exchangeCodeAndVerify, OidcFlowStore, oidcDocument } from './oidc'
import type { PersonSession, SessionStore } from './session-store'
import type { WorkbenchStateStore } from './state-store'

export const SESSION_COOKIE = 'workbench_session'

const DEV_USER = { name: '开发模式', preferred_username: 'dev', email: 'dev@localhost' }

/** demo 错误中间件迁移：PlatformError → 其 status/code；其他 → 500 WORKBENCH_ERROR */
export function errRes(error: unknown): Res {
  if (error instanceof PlatformError) {
    return { status: error.status, json: { error: { code: error.code, message: error.message } } }
  }
  return {
    status: 500,
    json: { error: { code: 'WORKBENCH_ERROR', message: error instanceof Error ? error.message : 'Unexpected workbench error' } },
  }
}

export interface PlatformAccessServiceDeps {
  profileDir: string
  loadConfig: (profileDir: string) => WorkbenchConfig
  installationId: string
  stateStore: WorkbenchStateStore
  sessionStore: SessionStore
  platform: PlatformClient
  configCache: PlatformConfigCache
  flows: OidcFlowStore
  enrollment: EnrollmentService
}

export class PlatformAccessService {
  constructor(private readonly deps: PlatformAccessServiceDeps) {}

  private async run(fn: () => Promise<Res>): Promise<Res> {
    try {
      return await fn()
    } catch (error) {
      return errRes(error)
    }
  }

  private config(): WorkbenchConfig {
    return this.deps.loadConfig(this.deps.profileDir)
  }

  private devDeny(): Res {
    return errRes(new PlatformError(503, 'PLATFORM_NOT_CONFIGURED', '未配置平台地址——请先在配置中填写管控平台地址'))
  }

  /** GET /auth/login（A-02） */
  async login(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      const cfg = this.config()
      if (isDevEnvironment(cfg)) return this.devDeny()
      let configuration: WorkbenchConfiguration
      try {
        configuration = await this.deps.platform.discover()
        await this.deps.configCache.write(configuration)
      } catch (discoverError) {
        // 022：发现失败时把底层原因（自签证书/连接拒绝/超时/JSON 解析）带出，便于现场定位
        const detail = discoverError instanceof Error ? discoverError.message : String(discoverError)
        console.error(`[platform-access] discover 失败（baseUrl=${cfg.platform.baseUrl}, insecureTls=${cfg.platform.insecureTls}）: ${detail}`)
        const cached = await this.deps.configCache.read()
        if (cached === undefined || !cacheMatchesConfig(cached, cfg.platform.baseUrl)) {
          throw new PlatformError(503, 'PLATFORM_UNREACHABLE', `平台不可达（无可用发现配置缓存）。底层原因：${detail}`)
        }
        configuration = cached
      }
      const document = await oidcDocument(configuration.oidc_issuer)
      const { verifier, challenge } = await createPkce()
      const { state, nonce } = this.deps.flows.create(configuration, verifier)
      const params = new URLSearchParams({
        client_id: configuration.oidc_client_id,
        redirect_uri: `http://${ctx.host}/auth/callback`,
        response_type: 'code',
        scope: 'openid',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // 027：强制重新认证——退出后即使 Keycloak SSO 会话残留（end_session 未访问/失败降级），
        // 再点登录也必须重新输入账号密码（桌面终端共享设备语义）
        prompt: 'login',
      })
      return { status: 302, redirect: `${document.authorization_endpoint}?${params}` }
    })
  }

  /** GET /auth/callback（A-02/A-03） */
  async callback(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) return this.devDeny()
      const code = ctx.query?.get('code') ?? ''
      const oidcState = ctx.query?.get('state') ?? ''
      const flow = this.deps.flows.take(oidcState)
      if (!code || !flow) throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'OIDC 登录流程无效或已过期')
      const document = await oidcDocument(flow.configuration.oidc_issuer)
      const tokens = await exchangeCodeAndVerify({
        document,
        configuration: flow.configuration,
        flow,
        code,
        redirectUri: `http://${ctx.host}/auth/callback`,
      })
      const sessionId = randomUUID()
      await this.deps.sessionStore.set(sessionId, {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        claims: tokens.claims,
        expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
      })
      const state = await this.deps.stateStore.loadOrCreate()
      try {
        await this.deps.enrollment.submitEnrollmentIfNeeded({ accessToken: tokens.accessToken }, state)
      } catch (error) {
        state.status = 'ERROR'
        state.error = error instanceof Error ? error.message : '自动提交接入申请失败'
        await this.deps.stateStore.save(state)
      }
      return {
        status: 302,
        redirect: '/',
        cookies: [{
          name: SESSION_COOKIE,
          value: sessionId,
          maxAgeSeconds: tokens.expiresInSeconds,
          httpOnly: true,
          sameSite: 'Strict',
          path: '/',
        }],
      }
    })
  }

  /** GET /api/state（会话可选，D-am3/D-am4） */
  async state(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) {
        return { status: 200, json: { installationId: this.deps.installationId, status: 'ACTIVE', authenticated: true, user: DEV_USER } }
      }
      const record = await this.deps.stateStore.loadOrCreate()
      const session = await this.readPersonSession(ctx)
      if (session !== undefined && !record.enrollmentId) {
        try {
          await this.deps.enrollment.submitEnrollmentIfNeeded(session, record)
        } catch (error) {
          record.status = 'ERROR'
          record.error = error instanceof Error ? error.message : '自动提交接入申请失败'
          await this.deps.stateStore.save(record)
        }
      }
      return {
        status: 200,
        json: {
          installationId: this.deps.installationId,
          enrollmentId: record.enrollmentId,
          workbenchId: record.workbenchId,
          status: record.status,
          lastHeartbeatAt: record.lastHeartbeatAt,
          rejectionReason: record.rejectionReason,
          error: record.error,
          authenticated: session !== undefined,
          user: session?.claims,
        },
      }
    })
  }

  /** POST /api/logout（偏差 #3：匿名也 200）。023：有 id_token 时返回 OIDC end_session URL 供前端整页跳转结束 Keycloak SSO。 */
  async logout(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      const sessionId = ctx.cookies?.[SESSION_COOKIE]
      let idToken: string | undefined
      if (sessionId !== undefined) {
        const session = await this.deps.sessionStore.get(sessionId)
        idToken = session?.idToken
        await this.deps.sessionStore.delete(sessionId)
      }
      let oidcLogoutUrl: string | undefined
      if (idToken && !isDevEnvironment(this.config())) {
        try {
          const configuration = await this.deps.platform.discover()
          const document = await oidcDocument(configuration.oidc_issuer)
          const endSession = document.end_session_endpoint
          if (endSession) {
            const params = new URLSearchParams({
              id_token_hint: idToken,
              post_logout_redirect_uri: `http://${ctx.host}/`,
            })
            oidcLogoutUrl = `${endSession}?${params}`
          }
        } catch (error) {
          // 发现/Keycloak 不可达时降级为仅本地登出（不阻断退出）；027：不再静默，留痕便于现场定位
          const detail = error instanceof Error ? error.message : String(error)
          console.warn(`[platform-access] 未能构造 OIDC end_session URL，降级为仅本地登出：${detail}`)
        }
      }
      return {
        status: 200,
        json: { status: 'logged_out', oidc_logout_url: oidcLogoutUrl },
        cookies: [{ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0, httpOnly: true, sameSite: 'Strict', path: '/' }],
      }
    })
  }

  /** POST /api/enroll（会话档） */
  async enroll(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) return this.devDeny()
      const person = await this.requirePerson(ctx)
      const record = await this.deps.stateStore.loadOrCreate()
      const enrollment = await this.deps.enrollment.submitEnrollmentIfNeeded(person, record, true)
      return { status: 200, json: { id: record.enrollmentId, status: record.status, created: enrollment } }
    })
  }

  /** POST /api/progress（会话档，G-2 定稿 POST） */
  async progress(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) return this.devDeny()
      const person = await this.requirePerson(ctx)
      const result = await this.deps.enrollment.progress(person)
      return { status: 200, json: result }
    })
  }

  /** POST /api/heartbeat（会话档，诊断手动入口；A-05 常态后台驱动） */
  async heartbeat(_ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) return this.devDeny()
      const record = await this.deps.stateStore.loadOrCreate()
      await this.deps.enrollment.acquireAndHeartbeat(record)
      return { status: 200, json: { status: record.status, lastHeartbeatAt: record.lastHeartbeatAt } }
    })
  }

  /** POST /api/reset（会话档，D-am2 保留身份） */
  async reset(ctx: Ctx): Promise<Res> {
    return this.run(async () => {
      if (isDevEnvironment(this.config())) return this.devDeny()
      await this.requirePerson(ctx)
      const result = await this.deps.enrollment.reset()
      return { status: 200, json: result }
    })
  }

  /** A-08 鉴权档位 guard（开发环境全放行，D-049 同一判据） */
  async sessionGuard(ctx: Ctx, grade: AuthGrade): Promise<Res | null> {
    if (isDevEnvironment(this.config())) return null
    const session = await this.readPersonSession(ctx)
    if (session === undefined) {
      return errRes(new PlatformError(401, 'PERSON_SESSION_INVALID', '请先使用企业账号登录'))
    }
    if (grade === 'session-active') {
      const record = await this.deps.stateStore.loadOrCreate()
      if (record.status !== 'ACTIVE') {
        return errRes(new PlatformError(403, 'ENROLLMENT_NOT_ACTIVE', '终端实例尚未激活，请先完成接入审批'))
      }
    }
    return null
  }

  async readPersonSession(ctx: Ctx): Promise<PersonSession | undefined> {
    const sessionId = ctx.cookies?.[SESSION_COOKIE]
    if (sessionId === undefined) return undefined
    return this.deps.sessionStore.get(sessionId)
  }

  private async requirePerson(ctx: Ctx): Promise<{ accessToken: string }> {
    const session = await this.readPersonSession(ctx)
    if (session === undefined) throw new PlatformError(401, 'PERSON_SESSION_INVALID', '请先使用企业账号登录')
    return { accessToken: session.accessToken }
  }
}
