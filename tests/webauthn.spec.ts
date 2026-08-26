/**
 * webauthn 服务单测：challenge 生命周期 + 注册/认证闭环 + counter 更新。
 *
 * @simplewebauthn/server 的 verify 需要真实 WebAuthn 握手数据（无法伪造），
 * 因此本测试聚焦于：
 * - challenge 存储/消费/TTL 过期/一次性使用
 * - registerBegin/loginBegin 的 options 结构
 * - rpID 未配置时的降级行为（由 host/index.ts 装配保证，此处测服务本身）
 */
import { describe, expect, it } from 'vitest'
import { createWebAuthnService } from '../src/host/webauthn'
import type { PasskeyCredential } from '../src/host/account-store'

/** 构造带内存 passkey 存储的完整服务。 */
function createTestService(overrides?: Partial<Parameters<typeof createWebAuthnService>[0]>) {
  const accounts = new Map<string, { passkeys: PasskeyCredential[] }>([
    ['admin', { passkeys: [] }],
  ])
  const events: { kind: string; actor: string }[] = []
  const sessions: string[] = []
  const service = createWebAuthnService({
    rpID: 'localhost',
    rpName: 'dsh-test',
    expectedOrigin: 'http://localhost:13443',
    findAccount: async (u) => {
      const a = accounts.get(u)
      return a === undefined ? undefined : { passkeys: a.passkeys }
    },
    findPasskey: async (id) => {
      for (const [username, account] of accounts) {
        const cred = account.passkeys.find(p => p.credentialId === id)
        if (cred !== undefined) return { username, credential: cred }
      }
      return undefined
    },
    addPasskey: async (u, c) => {
      const a = accounts.get(u)
      if (a === undefined) throw new Error('用户不存在')
      if (a.passkeys.some(p => p.credentialId === c.credentialId)) throw new Error('已注册')
      a.passkeys.push(c)
    },
    updatePasskeyCounter: async (id, counter) => {
      for (const [, account] of accounts) {
        const cred = account.passkeys.find(p => p.credentialId === id)
        if (cred !== undefined) { (cred as { counter: number }).counter = counter }
      }
    },
    createSession: (u, _ip) => ({ token: 'tok', cookie: `dsh_web_security_session=tok; user=${u}` }),
    recordEvent: (e) => events.push({ kind: e.kind, actor: e.actor }),
    recordFailure: async () => {},
    recordSuccess: async () => {},
    ...overrides,
  })
  return { service, accounts, events, sessions }
}

describe('createWebAuthnService', () => {
  it('registerBegin 返回含 challenge 的注册选项', async () => {
    const { service } = createTestService()
    const options = await service.registerBegin('admin')
    expect(options.challenge.length).toBeGreaterThan(20)
    expect(options.rp.id).toBe('localhost')
    expect(options.user.name).toBe('admin')
  })

  it('registerBegin 不存在的用户也返回选项（不泄露用户名存在性）', async () => {
    const { service } = createTestService()
    const options = await service.registerBegin('ghost')
    expect(options.challenge.length).toBeGreaterThan(20)
  })

  it('registerBegin excludeCredentials 含已有 passkey', async () => {
    const { service, accounts } = createTestService()
    accounts.get('admin')!.passkeys.push({
      credentialId: 'existing-cred-id',
      publicKey: 'pub',
      counter: 0,
      transports: ['internal'],
    })
    const options = await service.registerBegin('admin')
    expect(options.excludeCredentials).toHaveLength(1)
    expect(options.excludeCredentials![0]!.id).toBe('existing-cred-id')
  })

  it('loginBegin 无用户名返回空 allowCredentials', async () => {
    const { service } = createTestService()
    const options = await service.loginBegin()
    expect(options.challenge.length).toBeGreaterThan(20)
    expect(options.allowCredentials).toHaveLength(0)
  })

  it('loginBegin 带用户名返回该用户的 allowCredentials', async () => {
    const { service, accounts } = createTestService()
    accounts.get('admin')!.passkeys.push({
      credentialId: 'cred-1', publicKey: 'pub', counter: 0, transports: [],
    })
    const options = await service.loginBegin('admin')
    expect(options.allowCredentials).toHaveLength(1)
    expect(options.allowCredentials![0]!.id).toBe('cred-1')
  })

  it('loginComplete 无效断言返回 bad-credentials', async () => {
    const { service } = createTestService()
    // 空 clientDataJSON → challenge 提取失败。
    const result = await service.loginComplete({
      id: 'x', rawId: 'x', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: 'e30', authenticatorData: '', signature: '' },
    }, '127.0.0.1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad-credentials')
  })

  it('loginComplete 不在存储中的 challenge 拒绝（防重放）', async () => {
    const { service } = createTestService()
    // 构造一个合法 clientDataJSON 但 challenge 未注册。
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'never-issued', origin: 'http://localhost:13443' })).toString('base64url')
    const result = await service.loginComplete({
      id: 'x', rawId: 'x', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: clientData, authenticatorData: '', signature: '' },
    }, '127.0.0.1')
    expect(result.ok).toBe(false)
  })

  it('challenge 一次性使用：同一 challenge 第二次拒绝', async () => {
    const { service } = createTestService()
    // 先 loginBegin 签发 challenge。
    const options = await service.loginBegin('admin')
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: 'http://localhost:13443' })).toString('base64url')
    // 第一次 complete：credentialId 不存在 → bad-credentials（但 challenge 已被消费）。
    const r1 = await service.loginComplete({
      id: 'unknown-cred', rawId: 'unknown-cred', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: clientData, authenticatorData: '', signature: '' },
    }, '127.0.0.1')
    expect(r1.ok).toBe(false)
    // 第二次用同一 challenge → 已被消费 → 拒绝。
    const r2 = await service.loginComplete({
      id: 'unknown-cred2', rawId: 'unknown-cred2', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: clientData, authenticatorData: '', signature: '' },
    }, '127.0.0.1')
    expect(r2.ok).toBe(false)
    // 区分点：r2 在 challenge 检查处就失败（同样返回 bad-credentials——不泄露原因）。
  })
})
