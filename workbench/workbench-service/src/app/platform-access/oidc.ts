/**
 * OIDC 登录流（A-02；demo server.ts 登录/回调段拆出，设计 §5.5）：
 * - OidcFlowStore：state→flow 内存表，5min TTL、取出即删（单次使用）、create 机会式清扫
 * - oidcDocument：discovery 文档 + issuer 校验（demo oidcDocument 迁移，去 internalize）
 * - exchangeCodeAndVerify：code 换 token + id_token 验签（JWKS/iss/aud/nonce + clockTolerance 120s，
 *   设计 §7——demo 未设容忍，偏差 #2 裁决按设计）
 */
import { randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { WorkbenchConfiguration } from './platform-client'
import { PlatformError } from './platform-client'

const FLOW_TTL_MS = 300_000

export interface OidcFlow {
  verifier: string
  nonce: string
  createdAt: number
  configuration: WorkbenchConfiguration
}

export class OidcFlowStore {
  private readonly flows = new Map<string, OidcFlow>()

  create(configuration: WorkbenchConfiguration, verifier: string): { state: string; nonce: string } {
    const now = Date.now()
    for (const [key, flow] of this.flows) {
      if (now - flow.createdAt > FLOW_TTL_MS) this.flows.delete(key)
    }
    const state = randomBytes(24).toString('base64url')
    const nonce = randomBytes(24).toString('base64url')
    this.flows.set(state, { verifier, nonce, createdAt: now, configuration })
    return { state, nonce }
  }

  take(state: string): OidcFlow | undefined {
    const flow = this.flows.get(state)
    if (flow === undefined) return undefined
    this.flows.delete(state)
    if (Date.now() - flow.createdAt > FLOW_TTL_MS) return undefined
    return flow
  }
}

export async function oidcDocument(issuer: string): Promise<Record<string, string>> {
  let response: Response
  try {
    response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  } catch {
    throw new PlatformError(503, 'PLATFORM_UNREACHABLE', '平台不可达（OIDC discovery）')
  }
  if (!response.ok) throw new PlatformError(503, 'PLATFORM_UNREACHABLE', `OIDC discovery 应答 ${response.status}`)
  const document = (await response.json()) as Record<string, string>
  if (document.issuer !== issuer) throw new PlatformError(502, 'OIDC_ISSUER_MISMATCH', 'OIDC issuer 与发现配置不一致')
  return document
}

export interface ExchangeResult {
  accessToken: string
  idToken: string
  expiresInSeconds: number
  claims: Record<string, unknown>
}

export async function exchangeCodeAndVerify(input: {
  document: Record<string, string>
  configuration: WorkbenchConfiguration
  flow: OidcFlow
  code: string
  redirectUri: string
}): Promise<ExchangeResult> {
  const tokenResponse = await fetch(input.document.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.configuration.oidc_client_id,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.flow.verifier,
    }),
  })
  if (!tokenResponse.ok) throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'Keycloak 拒绝授权码')
  const tokens = (await tokenResponse.json()) as { access_token: string; id_token: string; expires_in: number }
  const jwks = createRemoteJWKSet(new URL(input.document.jwks_uri))
  const verified = await jwtVerify(tokens.id_token, jwks, {
    issuer: input.configuration.oidc_issuer,
    audience: input.configuration.oidc_client_id,
    clockTolerance: 120,
  })
  if (verified.payload.nonce !== input.flow.nonce) {
    throw new PlatformError(401, 'PERSON_SESSION_INVALID', 'OIDC nonce 不匹配')
  }
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    expiresInSeconds: tokens.expires_in,
    claims: verified.payload as Record<string, unknown>,
  }
}
