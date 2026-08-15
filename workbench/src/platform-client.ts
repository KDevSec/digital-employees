import { randomUUID } from 'node:crypto'

import type { JWK } from 'jose'

import { createPrivateKeyAssertion, createProofJwt } from './crypto.js'
import type { WorkbenchState } from './state-store.js'


export interface WorkbenchConfiguration {
  platform_base_url: string
  oidc_issuer: string
  oidc_client_id: string
  enrollment_endpoint: string
  machine_token_endpoint: string
  protocol_version: string
}

interface Challenge {
  challenge_id: string
  nonce: string
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

export class PlatformClient {
  constructor(
    readonly publicBaseUrl: string,
    readonly internalBaseUrl: string,
  ) {}

  private internalize(url: string): string {
    return url.startsWith(this.publicBaseUrl)
      ? `${this.internalBaseUrl}${url.slice(this.publicBaseUrl.length)}`
      : url
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.internalize(url), init)
    if (!response.ok) {
      let code = `HTTP_${response.status}`
      let message = response.statusText
      try {
        const payload = (await response.json()) as { error?: { code?: string; message?: string } }
        code = payload.error?.code ?? code
        message = payload.error?.message ?? message
      } catch {
        // Keep the non-sensitive HTTP fallback.
      }
      throw new PlatformError(response.status, code, message)
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  async discover(): Promise<WorkbenchConfiguration> {
    return this.request(`${this.publicBaseUrl}/.well-known/workbench-configuration`)
  }

  async submitEnrollment(state: WorkbenchState, accessToken: string): Promise<{ id: string; status: string }> {
    return this.request(`${this.publicBaseUrl}/api/v1/workbench-enrollments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installation_id: state.installationId,
        public_key: state.publicJwk,
        display_name: `Workbench ${state.installationId.slice(0, 8)}`,
        workbench_version: '0.1.0',
        os: process.platform,
        arch: process.arch,
      }),
    })
  }

  async enrollment(id: string, accessToken: string): Promise<{ status: string; workbench_instance_id?: string }> {
    return this.request(`${this.publicBaseUrl}/api/v1/workbench-enrollments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  }

  async completeEnrollment(state: WorkbenchState, accessToken: string): Promise<string> {
    if (!state.enrollmentId) throw new Error('Enrollment has not been submitted')
    const challenge = await this.request<Challenge>(
      `${this.publicBaseUrl}/api/v1/workbench-enrollments/${state.enrollmentId}/challenge`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const completeUrl = `${this.publicBaseUrl}/api/v1/workbench-enrollments/${state.enrollmentId}/complete`
    const proof = await createProofJwt(state.privateJwk, {
      audience: completeUrl,
      enrollmentId: state.enrollmentId,
      challengeId: challenge.challenge_id,
      nonce: challenge.nonce,
      installationId: state.installationId,
    })
    const result = await this.request<{ workbench_instance_id: string }>(completeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof_jwt: proof }),
    })
    return result.workbench_instance_id
  }

  async machineToken(workbenchId: string, privateJwk: JWK, tokenEndpoint: string): Promise<string> {
    const assertion = await createPrivateKeyAssertion(privateJwk, workbenchId, tokenEndpoint)
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: workbenchId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: 'workbench.heartbeat',
    })
    const result = await this.request<{ access_token: string }>(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return result.access_token
  }

  async heartbeat(workbenchId: string, machineToken: string): Promise<{ received_at: string }> {
    return this.request(`${this.publicBaseUrl}/api/v1/workbenches/${workbenchId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${machineToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: randomUUID(), reported_at: new Date().toISOString(), workbench_version: '0.1.0' }),
    })
  }
}
