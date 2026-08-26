/**
 * WebAuthn 服务端：passkey 注册/认证（@simplewebauthn/server v13）。
 *
 * 与框架无关的纯逻辑模块。安全特性：
 * - challenge 随机生成 + 一次性使用（防重放——内存 Map + TTL 5 分钟）；
 * - counter 校验（防凭证克隆——每次认证 counter 递增）；
 * - 注册需已认证用户；登录 public（discoverable credentials 支持）；
 * - expectedOrigin 从 tlsMode 推导（http → http://host:port；https → https://host:port）。
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'
import type { PasskeyCredential } from './account-store'
import type { LoginResult, RemoteEnvelope } from '../contracts/host-endpoints'
import type { AuthEvent } from '../contracts/auth-events'

/** challenge 存储条目（一次性使用 + TTL）。 */
interface ChallengeEntry {
  readonly challenge: string
  readonly username: string | undefined
  readonly expiresAt: number
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000
/** challenge Map 条目上限（防内存泄漏 DoS——审计 W2）。 */
const MAX_CHALLENGES = 10_000

/** 从 clientDataJSON（base64url）解码提取 challenge。 */
function extractChallenge(response: { clientDataJSON: string }): string | undefined {
  try {
    const json = JSON.parse(Buffer.from(response.clientDataJSON, 'base64url').toString('utf8')) as { challenge?: string }
    return json.challenge
  } catch {
    return undefined
  }
}

/** 创建 WebAuthn 服务。 */
export function createWebAuthnService(deps: {
  rpID: string
  rpName: string
  expectedOrigin: string
  findAccount: (username: string) => Promise<{ passkeys: readonly PasskeyCredential[] } | undefined>
  findPasskey: (credentialId: string) => Promise<{ username: string; credential: PasskeyCredential } | undefined>
  addPasskey: (username: string, credential: PasskeyCredential) => Promise<void>
  updatePasskeyCounter: (credentialId: string, counter: number) => Promise<void>
  createSession: (username: string, ip: string) => { token: string; cookie: string }
  recordEvent: (event: AuthEvent) => void
  recordFailure: (username: string) => Promise<void>
  recordSuccess: (username: string) => Promise<void>
}): {
  registerBegin: (username: string) => Promise<PublicKeyCredentialCreationOptionsJSON>
  registerComplete: (username: string, credential: RegistrationResponseJSON) => Promise<RemoteEnvelope<void>>
  loginBegin: (username?: string) => Promise<PublicKeyCredentialRequestOptionsJSON>
  loginComplete: (assertion: AuthenticationResponseJSON, ip: string) => Promise<LoginResult>
} {
  /** challenge → 条目（一次性使用 + TTL）。 */
  const challenges = new Map<string, ChallengeEntry>()

  function storeChallenge(challenge: string, username: string | undefined): void {
    // LRU 淘汰：超上限删最旧（Map 保持插入序——审计 W2）。
    if (challenges.size >= MAX_CHALLENGES) {
      const oldest = challenges.keys().next().value
      if (oldest !== undefined) challenges.delete(oldest)
    }
    challenges.set(challenge, { challenge, username, expiresAt: Date.now() + CHALLENGE_TTL_MS })
    cleanupChallenges()
  }

  function consumeChallenge(challenge: string): ChallengeEntry | undefined {
    const entry = challenges.get(challenge)
    if (entry === undefined) return undefined
    challenges.delete(challenge) // 一次性使用
    if (Date.now() > entry.expiresAt) return undefined
    return entry
  }

  function cleanupChallenges(): void {
    const now = Date.now()
    for (const [key, entry] of challenges) {
      if (now > entry.expiresAt) challenges.delete(key)
    }
  }

  async function registerBegin(username: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const account = await deps.findAccount(username)
    const existingPasskeys = account?.passkeys ?? []
    const options = await generateRegistrationOptions({
      rpName: deps.rpName,
      rpID: deps.rpID,
      userID: Buffer.from(username, 'utf8'),
      userName: username,
      excludeCredentials: existingPasskeys.map(p => ({
        type: 'public-key' as const,
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred' as const,
        userVerification: 'preferred' as const,
      },
    })
    storeChallenge(options.challenge, username)
    return options
  }

  async function registerComplete(username: string, credential: RegistrationResponseJSON): Promise<RemoteEnvelope<void>> {
    // challenge 从 clientDataJSON 解码提取（WebAuthn 标准——challenge 在 clientDataJSON 里）。
    const challenge = extractChallenge(credential.response)
    if (challenge === undefined) {
      return { ok: false, error: { code: 'challenge-missing', message: 'clientDataJSON 无 challenge' } }
    }
    const challengeEntry = consumeChallenge(challenge)
    if (challengeEntry === undefined || challengeEntry.username !== username) {
      return { ok: false, error: { code: 'challenge-mismatch', message: 'challenge 无效或已过期' } }
    }
    try {
      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challengeEntry.challenge,
        expectedOrigin: deps.expectedOrigin,
        expectedRPID: deps.rpID,
      })
      if (!verification.verified || verification.registrationInfo === undefined) {
        return { ok: false, error: { code: 'verification-failed', message: '注册验证失败' } }
      }
      const info = verification.registrationInfo
      // v13: registrationInfo.credential = { id, publicKey, counter, transports }
      const cred = info.credential
      const passkey: PasskeyCredential = {
        credentialId: cred.id,
        // publicKey 是 Uint8Array → base64url 存储
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter,
        transports: (cred.transports ?? credential.response.transports ?? []) as readonly string[],
      }
      await deps.addPasskey(username, passkey)
      deps.recordEvent({ kind: 'passkey-registered', at: Date.now(), actor: username, detail: passkey.credentialId.slice(0, 8) })
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: { code: 'register-error', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  async function loginBegin(username?: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    let allowCredentials: { type: 'public-key'; id: string; transports: AuthenticatorTransport[] }[] = []
    if (username !== undefined) {
      const account = await deps.findAccount(username)
      if (account !== undefined) {
        allowCredentials = account.passkeys.map(p => ({
          type: 'public-key',
          id: p.credentialId,
          transports: p.transports as AuthenticatorTransport[],
        }))
      }
    }
    const options = await generateAuthenticationOptions({
      rpID: deps.rpID,
      allowCredentials,
      userVerification: 'preferred',
    })
    storeChallenge(options.challenge, username)
    return options
  }

  async function loginComplete(assertion: AuthenticationResponseJSON, ip: string): Promise<LoginResult> {
    const challenge = extractChallenge(assertion.response)
    if (challenge === undefined) {
      return { ok: false, code: 'bad-credentials' }
    }
    const challengeEntry = consumeChallenge(challenge)
    if (challengeEntry === undefined) {
      return { ok: false, code: 'bad-credentials' }
    }
    const credentialId = assertion.id
    const found = await deps.findPasskey(credentialId)
    if (found === undefined) {
      return { ok: false, code: 'bad-credentials' }
    }
    // challenge 与断言用户一致性校验（审计 W1）：为 admin 签发的 challenge
    // 不能被其他用户的 passkey 断言消费。
    if (challengeEntry.username !== undefined && challengeEntry.username !== found.username) {
      deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: found.username, detail: 'passkey-challenge-user-mismatch' })
      return { ok: false, code: 'bad-credentials' }
    }
    try {
      const verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challengeEntry.challenge,
        expectedOrigin: deps.expectedOrigin,
        expectedRPID: deps.rpID,
        credential: {
          id: found.credential.credentialId,
          // 存储的 publicKey 是 base64url → Uint8Array 供 verify
          publicKey: Buffer.from(found.credential.publicKey, 'base64url'),
          counter: found.credential.counter,
          transports: found.credential.transports as AuthenticatorTransport[],
        },
      })
      if (!verification.verified) {
        await deps.recordFailure(found.username)
        deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: found.username, detail: 'passkey' })
        return { ok: false, code: 'bad-credentials' }
      }
      // counter 回退检测（审计 W3）：newCounter > 0 且 <= 存储 counter → 疑似克隆凭证。
      // counter 为 0 的 authenticator（不支持计数）跳过校验。
      const newCounter = verification.authenticationInfo?.newCounter ?? found.credential.counter
      if (newCounter > 0 && newCounter <= found.credential.counter) {
        deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: found.username, detail: `passkey-counter-regression (${found.credential.counter} → ${newCounter})` })
        return { ok: false, code: 'bad-credentials' }
      }
      await deps.updatePasskeyCounter(credentialId, newCounter)
      await deps.recordSuccess(found.username)
      deps.recordEvent({ kind: 'login-success', at: Date.now(), actor: found.username, detail: 'passkey' })
      const { cookie } = deps.createSession(found.username, ip)
      return { ok: true, cookie }
    } catch (error) {
      deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: found.username, detail: `passkey-error: ${error instanceof Error ? error.message : String(error)}` })
      return { ok: false, code: 'bad-credentials' }
    }
  }

  return { registerBegin, registerComplete, loginBegin, loginComplete }
}
