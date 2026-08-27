// @vitest-environment node
/**
 * host 端点层公开 seam 测试：passkeyRemove 端点行为（M4）。
 *
 * 规格：.scratch/m4-settings-ui/spec.md User Story 7/8。
 * mock SecurityDeps（系统边界注入面），断言端点的用户可观察行为：
 * 移除成功 + 审计事件、凭证不存在拒绝、最后凭证 + 密码登录关闭时自锁死拒绝。
 */
import { describe, expect, it } from 'vitest'
import { createHostSecurityEndpoints, type SecurityDeps } from '../src/contracts/host-endpoints'
import type { AuthEvent } from '../src/contracts/auth-events'
import type { SecuritySettings } from '../src/contracts/settings'

/** 构造可局部覆写的最小 SecurityDeps stub。 */
function makeDeps(overrides: Partial<SecurityDeps> = {}): SecurityDeps {
  const events: AuthEvent[] = []
  let settings: SecuritySettings = {
    passwordLogin: true, passkeyLogin: true, sessionTtlMinutes: 480,
    maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true,
  }
  const deps: SecurityDeps = {
    listAccounts: async () => [],
    verifyPassword: async () => false,
    createAccount: async () => {},
    updatePassword: async () => {},
    removeAccount: async () => {},
    hasAccounts: async () => true,
    loginGate: async () => ({ state: 'allowed' }),
    recordFailure: async () => {},
    recordSuccess: async () => {},
    createSession: () => ({ token: 't', cookie: 'c' }),
    resolveSession: () => undefined,
    revokeSession: () => {},
    revokeSessionsForUser: () => {},
    recordEvent: (e: AuthEvent) => { events.push(e) },
    readAudit: async () => ({ events: [], hasMore: false }),
    readSettings: () => settings,
    writeSettings: async (partial) => {
      settings = { ...settings, ...partial }
      return { ok: true, value: settings }
    },
    config: { enabled: true, entry: { host: '0.0.0.0', port: 3443, tls: 'self-signed' }, rpID: 'example.com', diagnostics: [] },
    passkeyRegisterBegin: async () => ({}),
    passkeyRegisterComplete: async () => ({ ok: true, value: undefined }),
    passkeyLoginBegin: async () => ({}),
    passkeyLoginComplete: async () => ({ ok: false, code: 'bad-credentials' }),
    listPasskeys: async () => [],
    removePasskey: async () => false,
    ...overrides,
  }
  return deps as SecurityDeps
}

/** 凭证样本（credentialId 用 base64url 字面量）。 */
const CRED_A = 'credAAAAAAAA'
const CRED_B = 'credBBBBBBBB'

describe('accountRemove 撤会话联动（M4）', () => {
  it('删除成功：撤销该账号全部会话并追加 session-expired 审计', async () => {
    const events: AuthEvent[] = []
    const revoked: string[] = []
    const deps = makeDeps({
      removeAccount: async () => {},
      revokeSessionsForUser: (username) => { revoked.push(username) },
      recordEvent: (e) => { events.push(e) },
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.accountRemove({ username: 'admin' })
    expect(result.ok).toBe(true)
    expect(revoked).toEqual(['admin'])
    const expired = events.find(e => e.kind === 'session-expired')
    expect(expired?.actor).toBe('admin')
    const removed = events.find(e => e.kind === 'account-removed')
    expect(removed?.actor).toBe('admin')
  })

  it('删除失败：不撤销会话', async () => {
    const revoked: string[] = []
    const deps = makeDeps({
      removeAccount: async () => { throw new Error('不存在') },
      revokeSessionsForUser: (username) => { revoked.push(username) },
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.accountRemove({ username: 'ghost' })
    expect(result.ok).toBe(false)
    expect(revoked).toEqual([])
  })
})

describe('passkeyRemove 端点（M4）', () => {
  it('移除成功：返回 ok 并追加 passkey-removed 审计事件', async () => {
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }, { credentialId: CRED_B }],
      removePasskey: async (username, credentialId) => username === 'admin' && credentialId === CRED_A,
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.passkeyRemove({ username: 'admin', credentialId: CRED_A })
    expect(result.ok).toBe(true)
  })

  it('wire 契约：Envelope<void> 的 ok 分支不得携带 value 字段（实机 gateway JSON 边界校验拒绝 undefined）', async () => {
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }],
      removePasskey: async () => true,
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const removed = await endpoints.passkeyRemove({ username: 'admin', credentialId: CRED_A })
    expect(removed.ok).toBe(true)
    expect('value' in removed).toBe(false)
    const createResult = await endpoints.accountCreate({ username: 'admin', password: 'SecurePass123!' })
    if (createResult.ok) expect('value' in createResult).toBe(false)
  })

  it('移除成功：审计事件 kind=passkey-removed、actor=用户名', async () => {
    const events: AuthEvent[] = []
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }],
      removePasskey: async () => true,
      recordEvent: (e) => { events.push(e) },
      // passwordLogin=true（默认），最后凭证也可移除。
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.passkeyRemove({ username: 'admin', credentialId: CRED_A })
    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('passkey-removed')
    expect(events[0]?.actor).toBe('admin')
  })

  it('凭证不存在：返回 passkey-not-found 错误且不写审计', async () => {
    const events: AuthEvent[] = []
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }],
      removePasskey: async () => false,
      recordEvent: (e) => { events.push(e) },
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.passkeyRemove({ username: 'admin', credentialId: 'missing' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('passkey-not-found')
    expect(events).toHaveLength(0)
  })

  it('自锁死防护：最后凭证 + passwordLogin=false → lockout-prevented', async () => {
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }],
      removePasskey: async () => false, // 不应被调用
      readSettings: () => ({
        passwordLogin: false, passkeyLogin: true, sessionTtlMinutes: 480,
        maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true,
      }),
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.passkeyRemove({ username: 'admin', credentialId: CRED_A })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('lockout-prevented')
  })

  it('非最后凭证 + passwordLogin=false：允许移除（仍有其他登录途径）', async () => {
    const deps = makeDeps({
      listPasskeys: async () => [{ credentialId: CRED_A }, { credentialId: CRED_B }],
      removePasskey: async () => true,
      readSettings: () => ({
        passwordLogin: false, passkeyLogin: true, sessionTtlMinutes: 480,
        maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true,
      }),
    })
    const endpoints = createHostSecurityEndpoints(deps)
    const result = await endpoints.passkeyRemove({ username: 'admin', credentialId: CRED_A })
    expect(result.ok).toBe(true)
  })
})
