/**
 * 安全端点纯接口（typert `security` 命名空间的业务面）。
 *
 * 与框架无关：实现接受注入依赖的工厂 `createHostSecurityEndpoints(deps, config)`
 * 返回本接口——宿主壳只做 Cordis/typert 适配，业务逻辑全部在此面之下。
 * 端点请求/响应类型必须能在浏览器侧做 zod strict 镜像（见 client/remote.ts，
 * M1 起实现；SRC 反射要求方法参数名保持 `request`、末位 `signal`）。
 */

import type { AuthEvent, LoginGate } from './auth-events'
import type { SecuritySettings } from './settings'

/** 状态诊断视图：登录页与设置界面共用。 */
export interface SecurityStatus {
  /** 安全入口是否启用。 */
  readonly enabled: boolean
  /** 是否已初始化账号（未初始化 → 前端显示初始化向导而非登录表单）。 */
  readonly hasAccounts: boolean
  /** 允许的登录方式。 */
  readonly methods: { readonly password: boolean; readonly passkey: boolean }
  /** 入口监听信息（host/port/tls 形态），仅元信息，不含私钥。 */
  readonly entry: {
    readonly host: string
    readonly port: number
    readonly tls: 'self-signed' | 'custom' | 'none'
  }
  /** 部署诊断（trustedHosts 必配项检查结果）。 */
  readonly diagnostics: readonly string[]
}

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
  /** 账号校验（用户名+密码是否正确）。 */
  verifyPassword(username: string, password: string): Promise<boolean>
  /** 登录限速判定（失败时由调用方登记）。 */
  loginGate(ip: string, username: string): Promise<LoginGate>
  /** 登记一次失败尝试。 */
  recordFailure(ip: string, username: string): Promise<void>
  /** 登记认证事件（审计）。 */
  recordEvent(event: AuthEvent): void
  /** 读取当前设置。 */
  readSettings(): SecuritySettings
}

/**
 * 安全端点工厂：为宿主壳装配纯业务实现。
 *
 * 骨架阶段返回占位实现（status 真实、登录类端点返回未实现错误码）；
 * M1 起按模块（account-store/session-store/rate-limiter/audit-log）填充。
 */
export function createHostSecurityEndpoints(
  deps: SecurityDeps,
): SecurityEndpoints {
  return {
    async status() {
      return {
        enabled: true,
        hasAccounts: false,
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
    async auditRead() {
      return { events: [], hasMore: false }
    },
    async settingsRead() {
      return deps.readSettings()
    },
  }
}

/** 安全端点完整接口（宿主 @Remote 逐一委托的方法面）。 */
export interface SecurityEndpoints {
  /** 状态与部署诊断。 */
  status(): Promise<SecurityStatus>
  /** 密码登录（M1 起实现真实校验与限速）。 */
  login(request: LoginRequest): Promise<LoginResult>
  /** 登出当前会话。 */
  logout(): Promise<void>
  /** 账号列表（仅元数据）。 */
  accountsList(): Promise<readonly AccountSummary[]>
  /** 审计日志读取（分页）。 */
  auditRead(request: AuditReadRequest): Promise<AuditReadResult>
  /** 读取当前安全设置。 */
  settingsRead(): Promise<SecuritySettings>
}