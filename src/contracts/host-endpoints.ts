/**
 * 安全端点纯接口（typert `security` 命名空间的业务面）。
 *
 * 与框架无关：实现接受注入依赖的工厂 `createHostSecurityEndpoints(deps)`
 * 返回本接口——宿主壳只做 Cordis/typert 适配，业务逻辑全部在此面之下。
 * 端点请求/响应类型必须能在浏览器侧做 zod strict 镜像（见 client/remote.ts，
 * M1 起实现；SRC 反射要求方法参数名保持 `request`、末位 `signal`）。
 */

import type { AuthEvent, LoginGate } from './auth-events'
import type { SecuritySettings } from './settings'

/** RPC 信封：传输层结果（ok/error）包裹业务返回值。 */
export type RemoteEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** 状态诊断视图：登录页与设置界面共用。 */
export interface SecurityStatus {
  /** 安全入口是否启用。 */
  readonly enabled: boolean
  /** 是否已初始化账号（未认证请求返回 null，不泄露初始化状态——审计 M1）。 */
  readonly hasAccounts: boolean | null
  /** 允许的登录方式。 */
  readonly methods: { readonly password: boolean; readonly passkey: boolean }
  /** 入口监听信息（host/port/tls 形态），仅元信息，不含私钥。 */
  readonly entry: {
    readonly host: string
    readonly port: number
    readonly tls: 'self-signed' | 'custom' | 'none'
  }
  /** 部署诊断（如 3080 非 loopback 绑定警告、TLS 形态提示）。 */
  readonly diagnostics: readonly string[]
}

/** 空请求（满足 SRC 参数契约；端点无业务参数时用此占位）。 */
export interface EmptyRequest {}

/** 状态请求（空对象——满足 SRC 参数契约 D-M1-1）。 */
export type StatusRequest = EmptyRequest
/** 登出请求（空对象）。 */
export type LogoutRequest = EmptyRequest
/** 账号列表请求（空对象）。 */
export type AccountsListRequest = EmptyRequest
/** 设置读取请求（空对象）。 */
export type SettingsReadRequest = EmptyRequest

/** 密码登录请求。 */
export interface LoginRequest {
  readonly username: string
  readonly password: string
}

/** 密码登录结果。 */
export type LoginResult =
  | { readonly ok: true; readonly cookie: string }
  | { readonly ok: false; readonly code: 'bad-credentials' | 'locked'; readonly retryAfterMs?: number }

/** 账号摘要（绝不含哈希/盐）。 */
export interface AccountSummary {
  readonly username: string
  readonly hasPasskey: boolean
  readonly createdAt: number
}

/** 创建账号请求。 */
export interface AccountCreateRequest {
  readonly username: string
  readonly password: string
}

/** 修改密码请求。 */
export interface AccountUpdatePasswordRequest {
  readonly username: string
  readonly currentPassword: string
  readonly newPassword: string
}

/** 删除账号请求。 */
export interface AccountRemoveRequest {
  readonly username: string
}

/** 写入设置请求（部分字段覆盖——mergeSettings 逐字段合并）。 */
export type SettingsWriteRequest = Partial<SecuritySettings>

/** 审计查询请求/响应。 */
export interface AuditReadRequest {
  readonly offset: number
  readonly limit: number
}
export interface AuditReadResult {
  readonly events: readonly AuthEvent[]
  readonly hasMore: boolean
}

/** 安全端点依赖注入面（由宿主壳装配五模块后提供）。 */
export interface SecurityDeps {
  // 账号面
  listAccounts(): Promise<readonly AccountSummary[]>
  verifyPassword(username: string, password: string): Promise<boolean>
  createAccount(username: string, password: string): Promise<void>
  updatePassword(username: string, current: string, next: string): Promise<void>
  removeAccount(username: string): Promise<void>
  hasAccounts(): Promise<boolean>
  // 限速面（username 维度——审计 S2）
  loginGate(username: string): Promise<LoginGate>
  recordFailure(username: string): Promise<void>
  recordSuccess(username: string): Promise<void>
  // 会话面
  createSession(username: string, ip: string): { token: string; cookie: string }
  resolveSession(token: string): { username: string } | undefined
  revokeSession(token: string): void
  // 审计面
  recordEvent(event: AuthEvent): void
  readAudit(offset: number, limit: number): Promise<{ events: readonly AuthEvent[]; hasMore: boolean }>
  // 设置面
  readSettings(): SecuritySettings
  writeSettings(partial: Partial<SecuritySettings>): Promise<{ ok: true; value: SecuritySettings } | { ok: false; error: { code: string; message: string } }>
  // 配置面
  readonly config: { enabled: boolean; entry: { host: string; port: number; tls: string }; rpID: string }
  // passkey 面（M3）
  passkeyRegisterBegin(username: string): Promise<unknown>
  passkeyRegisterComplete(username: string, credential: unknown): Promise<RemoteEnvelope<void>>
  passkeyLoginBegin(username?: string): Promise<unknown>
  passkeyLoginComplete(assertion: unknown, ip: string): Promise<LoginResult>
}

/** 安全端点完整接口（宿主 @Remote 逐一委托的方法面）。 */
export interface SecurityEndpoints {
  /** 状态与部署诊断。 */
  status(request: StatusRequest): Promise<SecurityStatus>
  /** 密码登录（真实校验与限速）。 */
  login(request: LoginRequest, signal?: AbortSignal): Promise<LoginResult>
  /** 登出当前会话。 */
  logout(request: LogoutRequest): Promise<void>
  /** 账号列表（仅元数据）。 */
  accountsList(request: AccountsListRequest): Promise<readonly AccountSummary[]>
  /** 创建账号（仅 loopback——审计 S1 首次初始化策略）。 */
  accountCreate(request: AccountCreateRequest): Promise<RemoteEnvelope<void>>
  /** 修改密码。 */
  accountUpdatePassword(request: AccountUpdatePasswordRequest): Promise<RemoteEnvelope<void>>
  /** 删除账号。 */
  accountRemove(request: AccountRemoveRequest): Promise<RemoteEnvelope<void>>
  /** 读取当前安全设置。 */
  settingsRead(request: SettingsReadRequest): Promise<SecuritySettings>
  /** 写入安全设置（部分字段覆盖；触发 settings-changed 审计——审计 M2）。 */
  settingsWrite(request: SettingsWriteRequest): Promise<RemoteEnvelope<SecuritySettings>>
  /** 审计日志读取（分页）。 */
  auditRead(request: AuditReadRequest, signal?: AbortSignal): Promise<AuditReadResult>
  /** passkey 注册开始（已认证用户）。 */
  passkeyRegisterBegin(request: PasskeyRegisterBeginRequest): Promise<RemoteEnvelope<unknown>>
  /** passkey 注册完成。 */
  passkeyRegisterComplete(request: PasskeyRegisterCompleteRequest): Promise<RemoteEnvelope<void>>
  /** passkey 登录开始（public）。 */
  passkeyLoginBegin(request: PasskeyLoginBeginRequest): Promise<RemoteEnvelope<unknown>>
  /** passkey 登录完成（public）。 */
  passkeyLoginComplete(request: PasskeyLoginCompleteRequest): Promise<LoginResult>
}

/** passkey 注册开始请求。 */
export interface PasskeyRegisterBeginRequest {
  readonly username: string
}
/** passkey 注册完成请求。 */
export interface PasskeyRegisterCompleteRequest {
  readonly username: string
  readonly credential: unknown
}
/** passkey 登录开始请求（username 可选——无用户名时用 discoverable credentials）。 */
export interface PasskeyLoginBeginRequest {
  readonly username?: string
}
/** passkey 登录完成请求。 */
export interface PasskeyLoginCompleteRequest {
  readonly assertion: unknown
}

/**
 * 安全端点工厂：组合 SecurityDeps 各面实现业务端点。
 *
 * 横切关注点（审计 M2）：login 成功/失败触发限速登记 + 审计事件；
 * settingsWrite 触发 settings-changed 审计事件。
 */
export function createHostSecurityEndpoints(
  deps: SecurityDeps,
): SecurityEndpoints {
  return {
    async status(_request: StatusRequest): Promise<SecurityStatus> {
      return {
        enabled: deps.config.enabled,
        hasAccounts: null,
        methods: { password: true, passkey: deps.config.rpID.length > 0 },
        entry: {
          host: deps.config.entry.host,
          port: deps.config.entry.port,
          tls: deps.config.entry.tls as 'self-signed' | 'custom' | 'none',
        },
        diagnostics: [],
      }
    },

    async login(request: LoginRequest, _signal?: AbortSignal): Promise<LoginResult> {
      // 限速门：username 维度（审计 S2——IP 维度归 M2 代理层）
      const gate = await deps.loginGate(request.username)
      if (gate.state === 'locked') {
        deps.recordEvent({ kind: 'login-locked', at: Date.now(), actor: request.username, detail: `retryAfterMs=${gate.retryAfterMs}` })
        return { ok: false, code: 'locked', retryAfterMs: gate.retryAfterMs }
      }
      const valid = await deps.verifyPassword(request.username, request.password)
      if (!valid) {
        await deps.recordFailure(request.username)
        deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: request.username })
        return { ok: false, code: 'bad-credentials' }
      }
      await deps.recordSuccess(request.username)
      deps.recordEvent({ kind: 'login-success', at: Date.now(), actor: request.username })
      // 创建会话并返回 cookie（M2 代理层 Set-Cookie）。
      // IP 用 'loopback' 占位（typert 端点无法获取客户端 IP——审计 S2）。
      const { cookie } = deps.createSession(request.username, 'loopback')
      return { ok: true, cookie }
    },

    async logout(_request: LogoutRequest): Promise<void> {
      // 会话撤销需要 token——端点层无 token 参数（从 M2 代理层的 cookie 取）
      // M1 占位：M2 代理层在 logout 时解析 cookie → 调 revokeSession
    },

    async accountsList(_request: AccountsListRequest): Promise<readonly AccountSummary[]> {
      return deps.listAccounts()
    },

    async accountCreate(request: AccountCreateRequest): Promise<RemoteEnvelope<void>> {
      try {
        await deps.createAccount(request.username, request.password)
        deps.recordEvent({ kind: 'account-created', at: Date.now(), actor: request.username })
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, error: { code: 'create-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    async accountUpdatePassword(request: AccountUpdatePasswordRequest): Promise<RemoteEnvelope<void>> {
      try {
        await deps.updatePassword(request.username, request.currentPassword, request.newPassword)
        deps.recordEvent({ kind: 'password-changed', at: Date.now(), actor: request.username })
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, error: { code: 'update-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    async accountRemove(request: AccountRemoveRequest): Promise<RemoteEnvelope<void>> {
      try {
        await deps.removeAccount(request.username)
        deps.recordEvent({ kind: 'account-removed', at: Date.now(), actor: request.username })
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, error: { code: 'remove-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    async settingsRead(_request: SettingsReadRequest): Promise<SecuritySettings> {
      return deps.readSettings()
    },

    async settingsWrite(request: SettingsWriteRequest): Promise<RemoteEnvelope<SecuritySettings>> {
      // 自锁死防护（审计 X2）：passwordLogin 与 passkeyLogin 不可同时关闭——
      // 否则无任何登录方式可用，唯一恢复手段是手改 settings.json。
      const current = deps.readSettings()
      const nextPassword = request.passwordLogin ?? current.passwordLogin
      const nextPasskey = request.passkeyLogin ?? current.passkeyLogin
      if (!nextPassword && !nextPasskey) {
        return { ok: false, error: { code: 'lockout-prevented', message: '不能同时关闭密码登录与通行密钥登录（防自锁死）' } }
      }
      const result = await deps.writeSettings(request)
      if (!result.ok) return result
      deps.recordEvent({ kind: 'settings-changed', at: Date.now(), actor: 'system', detail: JSON.stringify(Object.keys(request)) })
      return { ok: true, value: result.value }
    },

    async auditRead(request: AuditReadRequest, _signal?: AbortSignal): Promise<AuditReadResult> {
      return deps.readAudit(request.offset, request.limit)
    },

    async passkeyRegisterBegin(request: PasskeyRegisterBeginRequest): Promise<RemoteEnvelope<unknown>> {
      try {
        const options = await deps.passkeyRegisterBegin(request.username)
        return { ok: true, value: options }
      } catch (error) {
        return { ok: false, error: { code: 'passkey-register-begin-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    async passkeyRegisterComplete(request: PasskeyRegisterCompleteRequest): Promise<RemoteEnvelope<void>> {
      const result = await deps.passkeyRegisterComplete(request.username, request.credential)
      return result
    },

    async passkeyLoginBegin(request: PasskeyLoginBeginRequest): Promise<RemoteEnvelope<unknown>> {
      try {
        const options = await deps.passkeyLoginBegin(request.username)
        return { ok: true, value: options }
      } catch (error) {
        return { ok: false, error: { code: 'passkey-login-begin-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    async passkeyLoginComplete(request: PasskeyLoginCompleteRequest): Promise<LoginResult> {
      // IP 在 typert 端点层不可获取（审计 S2），传 'loopback' 占位。
      return deps.passkeyLoginComplete(request.assertion, 'loopback')
    },
  }
}
