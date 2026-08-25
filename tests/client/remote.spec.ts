/**
 * zod 镜像同步测试：解析 host 样本验证 schema 一致性（指南 7.2）。
 *
 * 每个 schema 用典型样本验证 parse 通过 + 非法样本 parse 拒绝。
 */
import { describe, expect, it } from 'vitest'
import {
  securityStatusSchema, loginRequestSchema, loginResultSchema,
  accountSummarySchema, accountCreateRequestSchema, accountUpdatePasswordRequestSchema,
  accountRemoveRequestSchema, settingsWriteRequestSchema, securitySettingsSchema,
  remoteEnvelopeVoidSchema, remoteEnvelopeSettingsSchema,
  auditReadRequestSchema, auditReadResultSchema,
} from '../../src/client/remote'

describe('zod 镜像同步', () => {
  it('securityStatus：合法样本 parse 通过', () => {
    expect(securityStatusSchema.parse({
      enabled: true, hasAccounts: null,
      methods: { password: true, passkey: false },
      entry: { host: '0.0.0.0', port: 3443, tls: 'self-signed' },
      diagnostics: [],
    })).toEqual(expect.any(Object))
  })

  it('securityStatus：非法 tls 枚举拒绝', () => {
    expect(() => securityStatusSchema.parse({
      enabled: true, hasAccounts: false,
      methods: { password: true, passkey: false },
      entry: { host: '0.0.0.0', port: 3443, tls: 'invalid' },
      diagnostics: [],
    })).toThrow()
  })

  it('loginRequest：合法样本', () => {
    expect(loginRequestSchema.parse({ username: 'admin', password: 'pass' }))
      .toEqual({ username: 'admin', password: 'pass' })
  })

  it('loginResult：ok=true 分支（含 cookie）', () => {
    const r = loginResultSchema.parse({ ok: true, cookie: 'dsh_web_security_session=abc; Path=/' })
    expect(r.ok).toBe(true)
  })

  it('loginResult：ok=false locked 分支', () => {
    expect(loginResultSchema.parse({ ok: false, code: 'locked', retryAfterMs: 60000 }))
      .toEqual({ ok: false, code: 'locked', retryAfterMs: 60000 })
  })

  it('loginResult：非法 code 拒绝', () => {
    expect(() => loginResultSchema.parse({ ok: false, code: 'unknown' })).toThrow()
  })

  it('accountSummary：合法样本', () => {
    expect(accountSummarySchema.parse({ username: 'admin', hasPasskey: false, createdAt: 1700000000000 }))
      .toEqual({ username: 'admin', hasPasskey: false, createdAt: 1700000000000 })
  })

  it('accountCreateRequest：合法样本', () => {
    expect(accountCreateRequestSchema.parse({ username: 'admin', password: 'pass' }))
      .toEqual({ username: 'admin', password: 'pass' })
  })

  it('accountUpdatePasswordRequest：合法样本', () => {
    expect(accountUpdatePasswordRequestSchema.parse({ username: 'admin', currentPassword: 'old', newPassword: 'new' }))
      .toEqual({ username: 'admin', currentPassword: 'old', newPassword: 'new' })
  })

  it('accountRemoveRequest：合法样本', () => {
    expect(accountRemoveRequestSchema.parse({ username: 'admin' })).toEqual({ username: 'admin' })
  })

  it('settingsWriteRequest：部分字段合法', () => {
    expect(settingsWriteRequestSchema.parse({ auditEnabled: false }))
      .toEqual({ auditEnabled: false })
  })

  it('settingsWriteRequest：maxLoginAttempts 超上限拒绝', () => {
    expect(() => settingsWriteRequestSchema.parse({ maxLoginAttempts: 100 })).toThrow()
  })

  it('securitySettings：完整样本', () => {
    expect(securitySettingsSchema.parse({
      passwordLogin: true, passkeyLogin: false, sessionTtlMinutes: 480,
      maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true,
    })).toEqual(expect.any(Object))
  })

  it('remoteEnvelope<void>：ok=true', () => {
    expect(remoteEnvelopeVoidSchema.parse({ ok: true, value: undefined }))
      .toEqual({ ok: true, value: undefined })
  })

  it('remoteEnvelope<void>：ok=false', () => {
    expect(remoteEnvelopeVoidSchema.parse({ ok: false, error: { code: 'failed', message: 'msg' } }))
      .toEqual({ ok: false, error: { code: 'failed', message: 'msg' } })
  })

  it('remoteEnvelope<Settings>：ok=true', () => {
    expect(remoteEnvelopeSettingsSchema.parse({
      ok: true,
      value: {
        passwordLogin: true, passkeyLogin: true, sessionTtlMinutes: 480,
        maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true,
      },
    })).toEqual(expect.any(Object))
  })

  it('auditReadRequest：合法分页', () => {
    expect(auditReadRequestSchema.parse({ offset: 0, limit: 10 })).toEqual({ offset: 0, limit: 10 })
  })

  it('auditReadRequest：offset 负数拒绝', () => {
    expect(() => auditReadRequestSchema.parse({ offset: -1, limit: 10 })).toThrow()
  })

  it('auditReadResult：合法样本', () => {
    expect(auditReadResultSchema.parse({ events: [], hasMore: false })).toEqual({ events: [], hasMore: false })
  })

  it('auditReadResult：带事件样本', () => {
    expect(auditReadResultSchema.parse({
      events: [{ kind: 'login-success', at: 1700000000000, actor: 'admin', ip: '127.0.0.1' }],
      hasMore: true,
    })).toEqual(expect.any(Object))
  })
})
