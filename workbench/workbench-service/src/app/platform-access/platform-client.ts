/**
 * 管控平台客户端（demo platform-client.ts 迁移 + 适配，设计 §5.4/偏差 #6/#11/#12）：
 * - getBaseUrl 运行时读取（PUT /api/config/platform 即时生效，D-049 语义）
 * - internal/public 双地址与 OIDC_INTERNAL_ISSUER 不迁移（V0.1 装机单地址，偏差 #6/#7）
 * - workbench_version ← brand.version 注入；display_name「终端 xxx」（品牌 §4）
 */
import { randomUUID } from 'node:crypto'
import type { JWK } from 'jose'

import { createPrivateKeyAssertion, createProofJwt } from './crypto'

export interface WorkbenchConfiguration {
  platform_base_url: string
  oidc_issuer: string
  oidc_client_id: string
  enrollment_endpoint: string
  machine_token_endpoint: string
  protocol_version: string
}

export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface PlatformClientDeps {
  getBaseUrl: () => string
  version: string
}

export class PlatformClient {
  constructor(private readonly deps: PlatformClientDeps) {}

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, init)
    if (!response.ok) {
      let code = `HTTP_${response.status}`
      let message = response.statusText
      try {
        const payload = (await response.json()) as { error?: { code?: string; message?: string } }
        code = payload.error?.code ?? code
        message = payload.error?.message ?? message
      } catch { /* 保持非敏感 HTTP 回退 */ }
      throw new PlatformError(response.status, code, message)
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  async discover(): Promise<WorkbenchConfiguration> {
    return this.request(`${this.deps.getBaseUrl()}/.well-known/workbench-configuration`)
  }

  async submitEnrollment(
    input: { installationId: string; publicJwk: JWK },
    accessToken: string,
  ): Promise<{ id: string; status: string }> {
    return this.request(`${this.deps.getBaseUrl()}/api/v1/workbench-enrollments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installation_id: input.installationId,
        public_key: input.publicJwk,
        display_name: `终端 ${input.installationId.slice(0, 8)}`,
        workbench_version: this.deps.version,
        os: process.platform,
        arch: process.arch,
      }),
    })
  }

  async enrollment(
    id: string,
    accessToken: string,
  ): Promise<{ status: string; workbench_instance_id?: string; review_reason?: string }> {
    return this.request(`${this.deps.getBaseUrl()}/api/v1/workbench-enrollments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  }

  async completeEnrollment(
    input: { enrollmentId: string; privateJwk: JWK; installationId: string },
    accessToken: string,
  ): Promise<string> {
    const base = this.deps.getBaseUrl()
    const challenge = await this.request<{ challenge_id: string; nonce: string }>(
      `${base}/api/v1/workbench-enrollments/${input.enrollmentId}/challenge`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const completeUrl = `${base}/api/v1/workbench-enrollments/${input.enrollmentId}/complete`
    const proof = await createProofJwt(input.privateJwk, {
      audience: completeUrl,
      enrollmentId: input.enrollmentId,
      challengeId: challenge.challenge_id,
      nonce: challenge.nonce,
      installationId: input.installationId,
    })
    const result = await this.request<{ workbench_instance_id: string }>(completeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof_jwt: proof }),
    })
    return result.workbench_instance_id
  }

  async machineToken(workbenchId: string, privateJwk: JWK, tokenEndpoint: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const assertion = await createPrivateKeyAssertion(privateJwk, workbenchId, tokenEndpoint)
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: workbenchId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: 'workbench.heartbeat',
    })
    const result = await this.request<{ access_token: string; expires_in?: number }>(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return { accessToken: result.access_token, expiresInSeconds: result.expires_in ?? 300 }
  }

  async heartbeat(workbenchId: string, machineToken: string): Promise<{ received_at: string }> {
    return this.request(`${this.deps.getBaseUrl()}/api/v1/workbenches/${workbenchId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${machineToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: randomUUID(),
        reported_at: new Date().toISOString(),
        workbench_version: this.deps.version,
      }),
    })
  }
}
