/**
 * dsh-web-security host 适配层：Cordis/typert 壳。
 *
 * 本文件是 host 端**唯一** import `@deepseek-ai/*` 的地方（连同
 * src/adapters/ 下其余适配文件；业务逻辑全部在 contracts/ 与 host/
 * 纯逻辑层）。职责：
 *   1. 将 Cordis Context 与宿主服务（webServer 等）适配为结构化注入面；
 *   2. 调用 `normalizeConfig` 校验部署方配置；
 *   3. 经 `createHostSecurityEndpoints(deps)` 获得纯业务端点；
 *   4. 以 `@Remote` 装饰器将端点暴露给 typert Gateway。
 *
 * M1：账号库/会话管理/限速器/审计日志装配进 deps，端点实现真实化。
 * M2：安全入口服务器（TLS + 认证门 + 反向代理）在自持端口监听，
 *     并在本壳装配其生命周期。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { normalizeConfig, type SecurityConfig } from './core'
import { createAccountStore } from './account-store'
import { createSessionStore } from './session-store'
import { createRateLimiter } from './rate-limiter'
import { createAuditLog } from './audit-log'
import { createSettingsStore } from './settings-store'
import { createEntryServer } from './entry-server'
import { resolvePluginDataRoot, nodeFs } from './plugin-data'
import { createHostSecurityEndpoints, type SecurityDeps, type SecurityEndpoints } from '../contracts/host-endpoints'
import { type SecuritySettings } from '../contracts/settings'
import type {
  AccountCreateRequest, AccountRemoveRequest, AccountSummary, AccountUpdatePasswordRequest,
  AuditReadRequest, AuditReadResult, LoginRequest, LoginResult, RemoteEnvelope,
  SecurityStatus, SettingsReadRequest, SettingsWriteRequest,
  StatusRequest, LogoutRequest, AccountsListRequest,
} from '../contracts/host-endpoints'
import type { AuthEvent } from '../contracts/auth-events'

/**
 * 安全 Remote 服务：Cordis 壳。
 *
 * 构造时规范化配置并装配 deps 与纯业务端点；`@Remote` 方法仅做委托。
 * SRC 契约约束：方法参数名必须是 `request`，可选取消槽必须是末位字面量
 * 名为 `signal`（typert 反射读取，宿主 bundle 永不 minify）。
 */
export class SecurityService extends TypertRemoteService {
  static inject = ['webServer']

  private readonly endpoints: SecurityEndpoints
  /** 规范化后的插件配置（供账号/会话/入口模块装配）。 */
  private readonly normalizedConfig: SecurityConfig

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'security')
    this.normalizedConfig = normalizeConfig(config)
    const deps = this.buildDeps()
    this.endpoints = createHostSecurityEndpoints(deps)
    // 装配入口服务器（蓝图 D2/D4——安全入口 + 认证门 + 反向代理）。
    if (this.normalizedConfig.enabled) {
      const entry = createEntryServer(deps, {
        host: this.normalizedConfig.entry.host,
        port: this.normalizedConfig.entry.port,
        tlsMode: this.normalizedConfig.entry.tlsMode,
        certPath: this.normalizedConfig.entry.tls.certPath,
        keyPath: this.normalizedConfig.entry.tls.keyPath,
        upstream: this.normalizedConfig.upstream,
        maxAttempts: this.normalizedConfig.rateLimit.maxAttempts,
        windowMs: this.normalizedConfig.rateLimit.windowMinutes * 60_000,
      })
      // 入口监听是异步的；失败时 logger.warn + 降级（不阻断宿主）。
      void entry.start().catch((err: unknown) => {
        this.ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
      })
      ctx.effect(() => () => { void entry.stop() }, 'web-security: entry server')
    }
  }

  /** 装配五模块为结构化 SecurityDeps。 */
  private buildDeps(): SecurityDeps {
    const cfg = this.normalizedConfig
    const dataRoot = resolvePluginDataRoot(cfg.dshHome)
    const accounts = createAccountStore(nodeFs, dataRoot)
    const sessions = createSessionStore(cfg.session.ttlMinutes)
    const rl = createRateLimiter(cfg.rateLimit.maxAttempts, cfg.rateLimit.windowMinutes * 60_000)
    const settings = createSettingsStore(nodeFs, dataRoot, cfg.defaultSettings)
    const audit = createAuditLog(nodeFs, dataRoot, settings.read().auditEnabled)
    // 生命周期：dispose 时 flush 审计残余 + 清理 timer（审计 V19）。
    this.ctx.effect(() => () => audit.dispose(), 'web-security: audit dispose')

    const deps: SecurityDeps = {
      // 账号面
      listAccounts: () => accounts.list(),
      verifyPassword: (u, p) => accounts.verifyPassword(u, p),
      createAccount: (u, p) => accounts.create(u, p),
      updatePassword: (u, c, n) => accounts.updatePassword(u, c, n),
      removeAccount: (u) => accounts.remove(u),
      hasAccounts: () => accounts.hasAny(),
      // 限速面
      loginGate: async (u) => rl.gate(u),
      recordFailure: async (u) => rl.recordFailure(u),
      recordSuccess: async (u) => rl.recordSuccess(u),
      // 会话面
      createSession: (u, ip) => sessions.create(u, ip),
      resolveSession: (token) => {
        const e = sessions.resolve(token)
        return e === undefined ? undefined : { username: e.username }
      },
      revokeSession: (token) => sessions.revoke(token),
      // 审计面
      recordEvent: (e: AuthEvent) => audit.append(e),
      readAudit: (offset, limit) => audit.read(offset, limit),
      // 设置面
      readSettings: () => settings.read(),
      writeSettings: (partial) => settings.write(partial),
      // 配置面
      config: {
        enabled: cfg.enabled,
        entry: { host: cfg.entry.host, port: cfg.entry.port, tls: cfg.entry.tls.certPath !== null ? 'custom' : 'self-signed' },
        rpID: cfg.rpID,
      },
    }
    return deps
  }

  // ── @Remote 端点（仅委托；M1 装配后横切审计/限速在 createHostSecurityEndpoints 内）──

  /** 状态与部署诊断。 */
  @Remote('status')
  async status(request: StatusRequest): Promise<SecurityStatus> {
    return this.endpoints.status(request)
  }

  /** 密码登录。 */
  @Remote('login')
  async login(request: LoginRequest, signal?: AbortSignal): Promise<LoginResult> {
    return this.endpoints.login(request, signal)
  }

  /** 登出当前会话。 */
  @Remote('logout')
  async logout(request: LogoutRequest): Promise<void> {
    return this.endpoints.logout(request)
  }

  /** 账号列表（仅元数据）。 */
  @Remote('accountsList')
  async accountsList(request: AccountsListRequest): Promise<readonly AccountSummary[]> {
    return this.endpoints.accountsList(request)
  }

  /** 创建账号（仅 loopback——审计 S1 首次初始化策略）。 */
  @Remote('accountCreate')
  async accountCreate(request: AccountCreateRequest): Promise<RemoteEnvelope<void>> {
    return this.endpoints.accountCreate(request)
  }

  /** 修改密码。 */
  @Remote('accountUpdatePassword')
  async accountUpdatePassword(request: AccountUpdatePasswordRequest): Promise<RemoteEnvelope<void>> {
    return this.endpoints.accountUpdatePassword(request)
  }

  /** 删除账号。 */
  @Remote('accountRemove')
  async accountRemove(request: AccountRemoveRequest): Promise<RemoteEnvelope<void>> {
    return this.endpoints.accountRemove(request)
  }

  /** 读取当前安全设置。 */
  @Remote('settingsRead')
  async settingsRead(request: SettingsReadRequest): Promise<SecuritySettings> {
    return this.endpoints.settingsRead(request)
  }

  /** 写入安全设置（部分字段覆盖；触发 settings-changed 审计）。 */
  @Remote('settingsWrite')
  async settingsWrite(request: SettingsWriteRequest): Promise<RemoteEnvelope<SecuritySettings>> {
    return this.endpoints.settingsWrite(request)
  }

  /** 审计日志读取（分页）。 */
  @Remote('auditRead')
  async auditRead(request: AuditReadRequest, signal?: AbortSignal): Promise<AuditReadResult> {
    return this.endpoints.auditRead(request, signal)
  }
}

export default SecurityService

export { normalizeConfig, DEFAULT_CONFIG, type SecurityConfig } from './core'
export { resolvePluginDataRoot, atomicWrite, PLUGIN_DATA_DIR } from './plugin-data'
export type {
  SecurityEndpoints, SecurityDeps, SecurityStatus, LoginRequest, LoginResult,
  AuditReadRequest, AuditReadResult, AccountSummary, RemoteEnvelope,
  AccountCreateRequest, AccountUpdatePasswordRequest, AccountRemoveRequest,
  SettingsWriteRequest,
} from '../contracts/host-endpoints'
export type { SecuritySettings } from '../contracts/settings'
