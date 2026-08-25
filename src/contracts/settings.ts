/**
 * 用户安全设置 schema（与部署方 patch config 分离的两套配置之一）。
 *
 * 双源合并规则（与 dsh-git-ui 同构）：
 *   1. 部署方 preset（patch `config.defaultSettings`）——安装即用默认值；
 *   2. 用户设置 `settings.json`（plugin-data 存储，经 storage RPC 读写）；
 *   3. 代码内 `DEFAULT_SETTINGS`（标准档，兜底）。
 *
 * 安全敏感项（账号、TLS 私钥路径等）绝不进入本 schema——它们只经 host 侧
 * 管理端点接触，绝不下发浏览器。
 */

/** 登录方式开关面（M1 起随实现逐步生效）。 */
export interface SecuritySettings {
  /** 是否允许账号密码登录（默认开）。 */
  readonly passwordLogin: boolean
  /** 是否允许通行密钥（WebAuthn）登录（默认开）。 */
  readonly passkeyLogin: boolean
  /** 登录成功的会话时长（分钟）。 */
  readonly sessionTtlMinutes: number
  /** 登录失败锁定阈值（次数）。 */
  readonly maxLoginAttempts: number
  /** 失败窗口（分钟）。 */
  readonly rateLimitWindowMinutes: number
  /** 是否记录审计日志（默认开）。 */
  readonly auditEnabled: boolean
}

/** 出厂标准档：代码内兜底默认值。 */
export const DEFAULT_SETTINGS: SecuritySettings = {
  passwordLogin: true,
  passkeyLogin: true,
  sessionTtlMinutes: 480,
  maxLoginAttempts: 5,
  rateLimitWindowMinutes: 15,
  auditEnabled: true,
}

/**
 * 安全策略数值区间的**单一来源**。
 *
 * 用户设置（SecuritySettings）与部署方预设（SecurityConfig.session/rateLimit）
 * 是同一组策略的两个配置层，区间必须共用本表——防止两处校验各自漂移。
 */
export const SETTINGS_RANGES = {
  /** 会话时长（分钟）：5 分钟 – 30 天。 */
  sessionTtlMinutes: { min: 5, max: 60 * 24 * 30 },
  /** 登录失败锁定阈值（次数）。 */
  maxLoginAttempts: { min: 1, max: 100 },
  /** 失败窗口（分钟）：1 – 24 小时。 */
  rateLimitWindowMinutes: { min: 1, max: 24 * 60 },
} as const

/** 字段级校验结果；非法字段给出可读原因。 */
export type SettingsValidation =
  | { readonly ok: true; readonly settings: SecuritySettings }
  | { readonly ok: false; readonly field: string; readonly message: string }

/** 数值区间的通用钳制（非法即拒绝，不静默修正；区间取值见 SETTINGS_RANGES）。 */
function inRange(value: number, min: number, max: number, field: string): SettingsValidation | undefined {
  if (!Number.isFinite(value) || value < min || value > max) {
    return { ok: false, field, message: `${field} 必须位于 ${min}–${max} 区间` }
  }
  return undefined
}

/**
 * 校验并规范化一份用户设置。
 *
 * 缺省语义：`undefined`/`null` 输入视为「未配置」→ 采用出厂标准档
 * （defaultSettings 未配置是常态，绝不能因此报错）；
 * 提供了对象则全字段校验，非法字段拒绝，绝不静默修正安全策略。
 * @param input - 任意结构输入（JSON 解析产物或部署方 preset）。
 * @returns 校验结果；ok 时携带完整字段的设置对象。
 */
export function validateSettings(input: unknown): SettingsValidation {
  if (input === undefined || input === null) {
    return { ok: true, settings: DEFAULT_SETTINGS }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, field: 'root', message: '设置必须是对象' }
  }
  const value = input as Record<string, unknown>
  const boolField = (name: string): SettingsValidation | undefined => {
    if (typeof value[name] !== 'boolean') {
      return { ok: false, field: name, message: `${name} 必须是布尔值` }
    }
    return undefined
  }
  const numberField = (name: string, min: number, max: number): SettingsValidation | undefined => {
    if (typeof value[name] !== 'number') {
      return { ok: false, field: name, message: `${name} 必须是数字` }
    }
    return inRange(value[name] as number, min, max, name)
  }

  const invalid =
    boolField('passwordLogin') ?? boolField('passkeyLogin') ?? boolField('auditEnabled')
    ?? numberField('sessionTtlMinutes', SETTINGS_RANGES.sessionTtlMinutes.min, SETTINGS_RANGES.sessionTtlMinutes.max)
    ?? numberField('maxLoginAttempts', SETTINGS_RANGES.maxLoginAttempts.min, SETTINGS_RANGES.maxLoginAttempts.max)
    ?? numberField('rateLimitWindowMinutes', SETTINGS_RANGES.rateLimitWindowMinutes.min, SETTINGS_RANGES.rateLimitWindowMinutes.max)
  if (invalid !== undefined) return invalid

  return {
    ok: true,
    settings: {
      passwordLogin: value.passwordLogin as boolean,
      passkeyLogin: value.passkeyLogin as boolean,
      sessionTtlMinutes: value.sessionTtlMinutes as number,
      maxLoginAttempts: value.maxLoginAttempts as number,
      rateLimitWindowMinutes: value.rateLimitWindowMinutes as number,
      auditEnabled: value.auditEnabled as boolean,
    },
  }
}