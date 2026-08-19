import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import express, { type NextFunction, type Request, type Response } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import { createPkce } from './crypto.js'
import { PlatformClient, PlatformError, type WorkbenchConfiguration } from './platform-client.js'
import { EncryptedStateStore, type WorkbenchState } from './state-store.js'
import { workbenchHtml } from './ui.js'


const port = Number(process.env.WORKBENCH_PORT ?? 19820)
const publicBaseUrl = process.env.WORKBENCH_PUBLIC_URL ?? `http://localhost:${port}`
const platformPublicUrl = process.env.PLATFORM_PUBLIC_URL ?? 'http://localhost:18000'
const platformInternalUrl = process.env.PLATFORM_INTERNAL_URL ?? platformPublicUrl
const oidcInternalIssuer = process.env.OIDC_INTERNAL_ISSUER
const statePath = resolve(process.env.WORKBENCH_STATE_PATH ?? './data/state.enc')
const stateSecret = process.env.WORKBENCH_STATE_SECRET ?? 'development-only-state-secret-change-me'

const app = express()
const store = new EncryptedStateStore(statePath, stateSecret)
const platform = new PlatformClient(platformPublicUrl, platformInternalUrl)
const flows = new Map<string, { verifier: string; nonce: string; createdAt: number; configuration: WorkbenchConfiguration }>()
const sessions = new Map<string, { accessToken: string; claims: Record<string, unknown>; expiresAt: number }>()
const machineTokens = new Map<string, string>()

async function submitEnrollmentIfNeeded(
  person: { accessToken: string },
  state: WorkbenchState,
): Promise<{ id: string; status: string } | undefined> {
  if (state.enrollmentId && !['REJECTED', 'ERROR'].includes(state.status)) {
    try {
      const existing = await platform.enrollment(state.enrollmentId, person.accessToken)
      state.status = existing.status as WorkbenchState['status']
      await store.save(state)
      return undefined
    } catch (error) {
      state.enrollmentId = undefined
      state.workbenchId = undefined
      state.status = 'NEW'
      state.lastHeartbeatAt = undefined
      state.rejectionReason = undefined
      state.error = undefined
      await store.save(state)
    }
  }
  const enrollment = await platform.submitEnrollment(state, person.accessToken)
  state.enrollmentId = enrollment.id
  state.status = enrollment.status as WorkbenchState['status']
  state.rejectionReason = undefined
  state.error = undefined
  await store.save(state)
  return enrollment
}

app.use(express.json({ limit: '32kb' }))

function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? '').split(';').map((value) => value.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2),
  )
}

function personSession(request: Request) {
  const id = cookies(request).workbench_session
  const session = id ? sessions.get(id) : undefined
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id)
    throw new PlatformError(401, 'PERSON_SESSION_INVALID', '请先使用企业账号登录')
  }
  return session
}

function internalizeOidc(url: string, publicIssuer: string): string {
  return oidcInternalIssuer && url.startsWith(publicIssuer)
    ? `${oidcInternalIssuer.replace(/\/$/, '')}${url.slice(publicIssuer.replace(/\/$/, '').length)}`
    : url
}

async function oidcDocument(issuer: string): Promise<Record<string, string>> {
  const response = await fetch(`${(oidcInternalIssuer ?? issuer).replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!response.ok) throw new Error('OIDC discovery failed')
  const document = (await response.json()) as Record<string, string>
  if (document.issuer !== issuer) throw new Error('OIDC issuer mismatch')
  return document
}

app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
app.get('/', (_request, response) => response.type('html').send(workbenchHtml(platformPublicUrl)))

app.get('/auth/login', async (_request, response, next) => {
  try {
    const configuration = await platform.discover()
    const document = await oidcDocument(configuration.oidc_issuer)
    const { verifier, challenge } = await createPkce()
    const state = randomBytes(24).toString('base64url')
    const nonce = randomBytes(24).toString('base64url')
    flows.set(state, { verifier, nonce, createdAt: Date.now(), configuration })
    const params = new URLSearchParams({
      client_id: configuration.oidc_client_id,
      redirect_uri: `${publicBaseUrl}/auth/callback`,
      response_type: 'code',
      scope: 'openid',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    response.redirect(`${document.authorization_endpoint}?${params}`)
  } catch (error) { next(error) }
})

app.get('/auth/callback', async (request, response, next) => {
  try {
    const code = String(request.query.code ?? '')
    const oidcState = String(request.query.state ?? '')
    const flow = flows.get(oidcState)
    if (!code || !flow || Date.now() - flow.createdAt > 300_000) throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'OIDC 登录流程无效或已过期')
    flows.delete(oidcState)
    const document = await oidcDocument(flow.configuration.oidc_issuer)
    const tokenResponse = await fetch(internalizeOidc(document.token_endpoint, flow.configuration.oidc_issuer), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: flow.configuration.oidc_client_id, redirect_uri: `${publicBaseUrl}/auth/callback`, code, code_verifier: flow.verifier }),
    })
    if (!tokenResponse.ok) throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'Keycloak 拒绝授权码')
    const tokens = (await tokenResponse.json()) as { access_token: string; id_token: string; expires_in: number }
    const jwks = createRemoteJWKSet(new URL(internalizeOidc(document.jwks_uri, flow.configuration.oidc_issuer)))
    const verified = await jwtVerify(tokens.id_token, jwks, { issuer: flow.configuration.oidc_issuer, audience: flow.configuration.oidc_client_id })
    if (verified.payload.nonce !== flow.nonce) throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'OIDC nonce 不匹配')
    const sessionId = randomUUID()
    sessions.set(sessionId, { accessToken: tokens.access_token, claims: verified.payload, expiresAt: Date.now() + tokens.expires_in * 1000 })
    response.cookie('workbench_session', sessionId, { httpOnly: true, sameSite: 'lax', secure: publicBaseUrl.startsWith('https://'), maxAge: tokens.expires_in * 1000 })
    const state = await store.loadOrCreate()
    try {
      await submitEnrollmentIfNeeded({ accessToken: tokens.access_token }, state)
    } catch (error) {
      state.status = 'ERROR'
      state.error = error instanceof Error ? error.message : '自动提交接入申请失败'
      await store.save(state)
    }
    response.redirect('/')
  } catch (error) { next(error) }
})

app.get('/api/state', async (request, response, next) => {
  try {
    const state = await store.loadOrCreate()
    let session
    try { session = personSession(request) } catch { session = undefined }
    if (session && !state.enrollmentId) {
      try {
        await submitEnrollmentIfNeeded(session, state)
      } catch (error) {
        state.status = 'ERROR'
        state.error = error instanceof Error ? error.message : '自动提交接入申请失败'
        await store.save(state)
      }
    }
    response.json({ ...state, privateJwk: undefined, publicJwk: undefined, authenticated: Boolean(session), user: session?.claims })
  } catch (error) { next(error) }
})

app.post('/api/enroll', async (request, response, next) => {
  try {
    const person = personSession(request)
    const state = await store.loadOrCreate()
    const enrollment = await submitEnrollmentIfNeeded(person, state)
    response.json({ id: state.enrollmentId, status: state.status, created: enrollment })
  } catch (error) { next(error) }
})

async function acquireAndHeartbeat(state: WorkbenchState, configuration: WorkbenchConfiguration): Promise<void> {
  if (!state.workbenchId) throw new Error('Workbench has not completed enrollment')
  const machineToken = await platform.machineToken(state.workbenchId, state.privateJwk, configuration.machine_token_endpoint)
  machineTokens.set(state.workbenchId, machineToken)
  const result = await platform.heartbeat(state.workbenchId, machineToken)
  state.lastHeartbeatAt = result.received_at
  state.status = 'ACTIVE'
  await store.save(state)
}

app.post('/api/progress', async (request, response, next) => {
  try {
    const person = personSession(request)
    const state = await store.loadOrCreate()
    if (!state.enrollmentId) throw new PlatformError(409, 'ENROLLMENT_NOT_FOUND', '请先提交接入申请')
    const enrollment = await platform.enrollment(state.enrollmentId, person.accessToken)
    state.status = enrollment.status as WorkbenchState['status']
    state.rejectionReason = enrollment.review_reason
    if (enrollment.status === 'APPROVED') state.workbenchId = await platform.completeEnrollment(state, person.accessToken)
    else if (enrollment.status === 'COMPLETED' && enrollment.workbench_instance_id) state.workbenchId = enrollment.workbench_instance_id
    else { await store.save(state); return response.json({ status: enrollment.status, review_reason: enrollment.review_reason }) }
    await acquireAndHeartbeat(state, await platform.discover())
    response.json({ status: state.status, workbenchId: state.workbenchId })
  } catch (error) { next(error) }
})

app.post('/api/heartbeat', async (_request, response, next) => {
  try {
    const state = await store.loadOrCreate()
    await acquireAndHeartbeat(state, await platform.discover())
    response.json({ status: state.status, lastHeartbeatAt: state.lastHeartbeatAt })
  } catch (error) { next(error) }
})

app.post('/api/reset', async (request, response, next) => {
  try {
    personSession(request)
    const state = await store.loadOrCreate()
    state.enrollmentId = undefined
    state.workbenchId = undefined
    state.status = 'NEW'
    state.lastHeartbeatAt = undefined
    state.rejectionReason = undefined
    state.error = undefined
    await store.save(state)
    response.json({ status: state.status })
  } catch (error) { next(error) }
})

app.post('/api/logout', (request, response) => {
  const id = cookies(request).workbench_session
  if (id) sessions.delete(id)
  response.clearCookie('workbench_session').json({ status: 'logged_out' })
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status = error instanceof PlatformError ? error.status : 500
  const code = error instanceof PlatformError ? error.code : 'WORKBENCH_ERROR'
  const message = error instanceof Error ? error.message : 'Unexpected workbench error'
  response.status(status).json({ error: { code, message } })
})

app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'workbench.started', port })))
