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
  | { readonly ok: true }
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

/** 安全端点依赖注入面（M1 实现时由宿主壳装配）。 */
export interface SecurityDeps {
  /** 账号校验（用户名+密码是否正确；不存在用户名执行假校验——审计 S3）。 */
  verifyPassword(username: string, password: string): Promise<boolean>
  /** 登录限速判定（username 维度——IP 维度归 M2 代理层，审计 S2）。 */
  loginGate(username: string): Promise<LoginGate>
  /** 登记一次失败（username 维度）。 */
  recordFailure(username: string): Promise<void>
  /** 登记成功（重置该 username 计数）。 */
  recordSuccess(username: string): Promise<void>
  /** 登记认证事件（审计；安全降级操作如 settingsWrite 也应触发——审计 M2）。 */
  recordEvent(event: AuthEvent): void
  /** 读取当前设置。 */
  readSettings(): SecuritySettings
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
}

/**
 * 安全端点工厂：为宿主壳装配纯业务实现。
 *
 * 骨架阶段返回占位实现（登录类端点返回占位错误码）；
 * M1 起按模块（account-store/session-store/rate-limiter/audit-log）填充。
 */
export function createHostSecurityEndpoints(
  deps: SecurityDeps,
): SecurityEndpoints {
  return {
    async status() {
      // 占位：entry 三元组为骨架示意，M1 起从规范化配置取真实值。
      return {
        enabled: true,
        hasAccounts: null,
        methods: { password: true, passkey: false },
        entry: { host: '0.0.0.0', port: 3443, tls: 'self-signed' },
        diagnostics: [],
      }
    },
    async login() {
      return { ok: false, code: 'bad-credentials' }
    },
    async logout() {},
    async accountsList() {
      return []
    },
    async accountCreate() {
      return { ok: false, error: { code: 'not-implemented', message: 'M1 未装配' } }
    },
    async accountUpdatePassword() {
      return { ok: false, error: { code: 'not-implemented', message: 'M1 未装配' } }
    },
    async accountRemove() {
      return { ok: false, error: { code: 'not-implemented', message: 'M1 未装配' } }
    },
    async settingsRead() {
      return deps.readSettings()
    },
    async settingsWrite() {
      return { ok: false, error: { code: 'not-implemented', message: 'M1 未装配' } }
    },
    async auditRead() {
      return { events: [], hasMore: false }
    },
  }
}
