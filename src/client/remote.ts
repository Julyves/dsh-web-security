/**
 * client 侧 Typert Remote contribution：security 命名空间的 zod 镜像。
 *
 * host 侧通过 SRC 发现暴露 `security/<method>`；浏览器侧必须挂载等价的
 * strict contribution（requireStrictDescriptor 强制 zod codec），故此处
 * schema 与 `src/contracts/host-endpoints.ts` 手写同步。
 * `tests/client/remote.spec.ts` 通过解析 host 样本守护一致性（指南 7.2）。
 */

import { z } from 'zod'
import { SETTINGS_RANGES } from '../contracts/settings'

// ── zod schema（与 host 类型手写同步）──

export const securityStatusSchema = z.object({
  enabled: z.boolean(),
  hasAccounts: z.boolean().nullable(),
  methods: z.object({ password: z.boolean(), passkey: z.boolean() }),
  entry: z.object({
    host: z.string(),
    port: z.number(),
    tls: z.enum(['self-signed', 'custom', 'none']),
  }),
  diagnostics: z.array(z.string()),
})

export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
})

export const loginResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), cookie: z.string() }),
  z.object({ ok: z.literal(false), code: z.enum(['bad-credentials', 'locked']), retryAfterMs: z.number().optional() }),
])

export const accountSummarySchema = z.object({
  username: z.string(),
  hasPasskey: z.boolean(),
  createdAt: z.number(),
})

export const accountCreateRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
})

export const accountUpdatePasswordRequestSchema = z.object({
  username: z.string(),
  currentPassword: z.string(),
  newPassword: z.string(),
})

export const accountRemoveRequestSchema = z.object({
  username: z.string(),
})

export const settingsReadRequestSchema = z.object({})

export const settingsWriteRequestSchema = z.object({
  passwordLogin: z.boolean().optional(),
  passkeyLogin: z.boolean().optional(),
  sessionTtlMinutes: z.number().min(SETTINGS_RANGES.sessionTtlMinutes.min).max(SETTINGS_RANGES.sessionTtlMinutes.max).optional(),
  maxLoginAttempts: z.number().min(SETTINGS_RANGES.maxLoginAttempts.min).max(SETTINGS_RANGES.maxLoginAttempts.max).optional(),
  rateLimitWindowMinutes: z.number().min(SETTINGS_RANGES.rateLimitWindowMinutes.min).max(SETTINGS_RANGES.rateLimitWindowMinutes.max).optional(),
  auditEnabled: z.boolean().optional(),
})

export const securitySettingsSchema = z.object({
  passwordLogin: z.boolean(),
  passkeyLogin: z.boolean(),
  sessionTtlMinutes: z.number(),
  maxLoginAttempts: z.number(),
  rateLimitWindowMinutes: z.number(),
  auditEnabled: z.boolean(),
})

export const remoteEnvelopeVoidSchema = z.discriminatedUnion('ok', [
  // ok 分支不带 value 字段（host wire 契约：undefined 属性被 gateway JSON 边界校验拒绝）。
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
])

/** passkey 请求 schema（M3）。 */
export const passkeyRegisterBeginRequestSchema = z.object({
  username: z.string(),
})
export const passkeyRegisterCompleteRequestSchema = z.object({
  username: z.string(),
  credential: z.unknown(),
})
export const passkeyLoginBeginRequestSchema = z.object({
  username: z.string().optional(),
})
export const passkeyLoginCompleteRequestSchema = z.object({
  assertion: z.unknown(),
})
/** passkey 移除请求（M4）。 */
export const passkeyRemoveRequestSchema = z.object({
  username: z.string(),
  credentialId: z.string(),
})
/** 列凭证请求（M4）。 */
export const listPasskeysRequestSchema = z.object({
  username: z.string(),
})
/** 凭证摘要（M4）。 */
export const passkeySummarySchema = z.object({
  credentialId: z.string(),
})
/** WebAuthn options（PublicKeyCredentialCreationOptionsJSON / RequestOptionsJSON 的宽松镜像——字段由浏览器端消费）。 */
export const passkeyOptionsSchema = z.record(z.string(), z.unknown())

export const remoteEnvelopeSettingsSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: securitySettingsSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
])

export const auditReadRequestSchema = z.object({
  offset: z.number().min(0),
  limit: z.number().min(1).max(1000),
})

export const auditReadResultSchema = z.object({
  events: z.array(z.object({
    kind: z.string(),
    at: z.number(),
    actor: z.string(),
    ip: z.string().optional(),
    detail: z.string().optional(),
  })),
  hasMore: z.boolean(),
})

/** 空请求 schema（满足 SRC 参数契约 D-M1-1）。 */
const emptyRequestSchema = z.object({})

// ── Typert Remote contribution descriptor ──

/** security 命名空间的 client 侧 Remote 贡献。 */
export const securityRemoteContribution = {
  namespace: 'security',
  service: 'security',
  descriptors: [
    {
      id: 'dsh-web-security#security/status',
      service: 'security', namespace: 'security', method: 'status',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#StatusRequest', schema: emptyRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#SecurityStatus', schema: securityStatusSchema },
    },
    {
      id: 'dsh-web-security#security/login',
      service: 'security', namespace: 'security', method: 'login',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#LoginRequest', schema: loginRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#LoginResult', schema: loginResultSchema },
    },
    {
      id: 'dsh-web-security#security/logout',
      service: 'security', namespace: 'security', method: 'logout',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#LogoutRequest', schema: emptyRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#void', schema: z.undefined() },
    },
    {
      id: 'dsh-web-security#security/accountsList',
      service: 'security', namespace: 'security', method: 'accountsList',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AccountsListRequest', schema: emptyRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AccountSummary[]', schema: z.array(accountSummarySchema) },
    },
    {
      id: 'dsh-web-security#security/accountCreate',
      service: 'security', namespace: 'security', method: 'accountCreate',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AccountCreateRequest', schema: accountCreateRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<void>', schema: remoteEnvelopeVoidSchema },
    },
    {
      id: 'dsh-web-security#security/accountUpdatePassword',
      service: 'security', namespace: 'security', method: 'accountUpdatePassword',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AccountUpdatePasswordRequest', schema: accountUpdatePasswordRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<void>', schema: remoteEnvelopeVoidSchema },
    },
    {
      id: 'dsh-web-security#security/accountRemove',
      service: 'security', namespace: 'security', method: 'accountRemove',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AccountRemoveRequest', schema: accountRemoveRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<void>', schema: remoteEnvelopeVoidSchema },
    },
    {
      id: 'dsh-web-security#security/settingsRead',
      service: 'security', namespace: 'security', method: 'settingsRead',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#SettingsReadRequest', schema: emptyRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#SecuritySettings', schema: securitySettingsSchema },
    },
    {
      id: 'dsh-web-security#security/settingsWrite',
      service: 'security', namespace: 'security', method: 'settingsWrite',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#SettingsWriteRequest', schema: settingsWriteRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<SecuritySettings>', schema: remoteEnvelopeSettingsSchema },
    },
    {
      id: 'dsh-web-security#security/auditRead',
      service: 'security', namespace: 'security', method: 'auditRead',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AuditReadRequest', schema: auditReadRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#AuditReadResult', schema: auditReadResultSchema },
    },
    // ── passkey 端点（M3）──
    {
      id: 'dsh-web-security#security/passkeyRegisterBegin',
      service: 'security', namespace: 'security', method: 'passkeyRegisterBegin',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeyRegisterBeginRequest', schema: passkeyRegisterBeginRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<unknown>', schema: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), value: passkeyOptionsSchema }),
        z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
      ]) },
    },
    {
      id: 'dsh-web-security#security/passkeyRegisterComplete',
      service: 'security', namespace: 'security', method: 'passkeyRegisterComplete',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeyRegisterCompleteRequest', schema: passkeyRegisterCompleteRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<void>', schema: remoteEnvelopeVoidSchema },
    },
    {
      id: 'dsh-web-security#security/passkeyLoginBegin',
      service: 'security', namespace: 'security', method: 'passkeyLoginBegin',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeyLoginBeginRequest', schema: passkeyLoginBeginRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<unknown>', schema: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), value: passkeyOptionsSchema }),
        z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
      ]) },
    },
    {
      id: 'dsh-web-security#security/passkeyLoginComplete',
      service: 'security', namespace: 'security', method: 'passkeyLoginComplete',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeyLoginCompleteRequest', schema: passkeyLoginCompleteRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#LoginResult', schema: loginResultSchema },
    },
    // ── passkey 移除（M4）──
    {
      id: 'dsh-web-security#security/passkeyRemove',
      service: 'security', namespace: 'security', method: 'passkeyRemove',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeyRemoveRequest', schema: passkeyRemoveRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#RemoteEnvelope<void>', schema: remoteEnvelopeVoidSchema },
    },
    // ── 列凭证（M4）──
    {
      id: 'dsh-web-security#security/listPasskeys',
      service: 'security', namespace: 'security', method: 'listPasskeys',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-web-security/types#ListPasskeysRequest', schema: listPasskeysRequestSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-web-security/types#PasskeySummary[]', schema: z.array(passkeySummarySchema) },
    },
  ],
}
