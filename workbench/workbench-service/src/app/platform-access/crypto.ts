/**
 * 认证密码学原语（A-02/A-04/A-05；随迁 workbench-demo/src/crypto.ts，零语义变更——设计 §7 偏差清单无涉）。
 * PKCE S256 / ES256 JWK 对生成 / private_key_jwt 断言 / enrollment proof JWT。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose'


function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export async function importPublicKey(publicJwk: JWK) {
  return importJWK(publicJwk, 'ES256')
}

export async function createPrivateKeyAssertion(
  privateJwk: JWK,
  workbenchId: string,
  audience: string,
): Promise<string> {
  const key = await importJWK(privateJwk, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuer(workbenchId)
    .setSubject(workbenchId)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('2m')
    .setJti(randomUUID())
    .sign(key)
}

export interface EnrollmentProofInput {
  audience: string
  enrollmentId: string
  challengeId: string
  nonce: string
  installationId: string
}

export async function createProofJwt(privateJwk: JWK, input: EnrollmentProofInput): Promise<string> {
  const key = await importJWK(privateJwk, 'ES256')
  return new SignJWT({
    enrollment_request_id: input.enrollmentId,
    challenge_id: input.challengeId,
    nonce: input.nonce,
    installation_id: input.installationId,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(input.audience)
    .setIssuedAt()
    .setExpirationTime('2m')
    .setJti(randomUUID())
    .sign(key)
}

export async function newEs256Jwks(): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  return { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) }
}
