import { describe, expect, it } from 'vitest'
import { decodeJwt, exportJWK, generateKeyPair, jwtVerify } from 'jose'

import { createPkce, createPrivateKeyAssertion, createProofJwt } from '../src/crypto.js'


describe('workbench cryptography', () => {
  it('creates an S256 PKCE challenge without exposing the verifier', async () => {
    const first = await createPkce()
    const second = await createPkce()

    expect(first.verifier).not.toBe(second.verifier)
    expect(first.challenge).not.toContain(first.verifier)
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('creates a private_key_jwt bound to the workbench and token endpoint', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const privateJwk = await exportJWK(privateKey)
    const publicJwk = await exportJWK(publicKey)
    const token = await createPrivateKeyAssertion(
      privateJwk,
      'workbench-1',
      'http://platform.test/oauth2/workbench/token',
    )

    const verified = await jwtVerify(token, await import('../src/crypto.js').then((m) => m.importPublicKey(publicJwk)), {
      algorithms: ['ES256'],
      audience: 'http://platform.test/oauth2/workbench/token',
      issuer: 'workbench-1',
      subject: 'workbench-1',
    })
    expect(verified.payload.jti).toBeTruthy()
    expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBeLessThanOrEqual(120)
  })

  it('binds enrollment proof to challenge, nonce and installation', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true })
    const privateJwk = await exportJWK(privateKey)
    const proof = await createProofJwt(privateJwk, {
      audience: 'http://platform.test/api/v1/workbench-enrollments/enroll-1/complete',
      enrollmentId: 'enroll-1',
      challengeId: 'challenge-1',
      nonce: 'real-nonce',
      installationId: 'install-1',
    })

    expect(decodeJwt(proof)).toMatchObject({
      enrollment_request_id: 'enroll-1',
      challenge_id: 'challenge-1',
      nonce: 'real-nonce',
      installation_id: 'install-1',
    })
  })
})
