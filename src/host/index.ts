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
import { createHostSecurityEndpoints, type SecurityDeps, type SecurityEndpoints } from '../contracts/host-endpoints'
import {
  validateSettings,
  type SecuritySettings,
} from '../contracts/settings'
import type {
  AccountSummary, AuditReadRequest, AuditReadResult, LoginRequest, LoginResult, SecurityStatus,
} from '../contracts/host-endpoints'

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
  /** 规范化后的插件配置（M1 起供账号/会话/入口模块装配）。 */
  private readonly normalizedConfig: SecurityConfig

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'security')
    this.normalizedConfig = normalizeConfig(config)
    this.endpoints = createHostSecurityEndpoints(this.buildDeps())
  }

  /** 将配置规范化产物适配为结构化 SecurityDeps（M1 起替换为真实模块）。 */
  private buildDeps(): SecurityDeps {
    return {
      verifyPassword: async () => false,
      loginGate: async () => ({ state: 'allowed' }),
      recordFailure: async () => {},
      recordEvent: () => {},
      readSettings: () => {
        // 出厂预设优先：patch config.defaultSettings 非法时大声失败
        // （与 normalizeConfig 策略一致，绝不静默修正安全策略）。
        const preset = validateSettings(this.normalizedConfig.defaultSettings)
        if (!preset.ok) {
          throw new Error(`web-security: defaultSettings 非法（${preset.field}: ${preset.message}）`)
        }
        return preset.settings
      },
    }
  }

  /** 状态与部署诊断。 */
  @Remote('status')
  async status(signal?: AbortSignal): Promise<SecurityStatus> {
    void signal
    return this.endpoints.status()
  }

  /** 密码登录。 */
  @Remote('login')
  async login(request: LoginRequest, signal?: AbortSignal): Promise<LoginResult> {
    void signal
    return this.endpoints.login(request)
  }

  /** 登出当前会话。 */
  @Remote('logout')
  async logout(signal?: AbortSignal): Promise<void> {
    void signal
    return this.endpoints.logout()
  }

  /** 账号列表（仅元数据）。 */
  @Remote('accountsList')
  async accountsList(signal?: AbortSignal): Promise<readonly AccountSummary[]> {
    void signal
    return this.endpoints.accountsList()
  }

  /** 审计日志读取（分页）。 */
  @Remote('auditRead')
  async auditRead(request: AuditReadRequest, signal?: AbortSignal): Promise<AuditReadResult> {
    void signal
    return this.endpoints.auditRead(request)
  }

  /** 读取当前安全设置。 */
  @Remote('settingsRead')
  async settingsRead(signal?: AbortSignal): Promise<SecuritySettings> {
    void signal
    return this.endpoints.settingsRead()
  }
}

export default SecurityService

export { normalizeConfig, DEFAULT_CONFIG, type SecurityConfig } from './core'
export { resolvePluginDataRoot, atomicWrite, PLUGIN_DATA_DIR } from './plugin-data'
export type {
  SecurityEndpoints, SecurityDeps, SecurityStatus, LoginRequest, LoginResult,
  AuditReadRequest, AuditReadResult, AccountSummary,
} from '../contracts/host-endpoints'
export type { SecuritySettings } from '../contracts/settings'