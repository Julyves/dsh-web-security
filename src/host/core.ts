import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 插件配置规范化（部署方 patch `config` 的解析与校验）。
 *
 * 与框架无关的纯函数；`normalizeConfig` 对任意结构输入做字段级校验，
 * 非法即抛错（「错误配置大声失败」，绝不静默修正安全策略）。
 */

/** 入口 TLS 形态：certPath/keyPath 均为 null → 自签；二者齐全 → 用户证书。 */
export interface EntryTlsConfig {
  readonly certPath: string | null
  readonly keyPath: string | null
}

/** 插件配置（与 cordis.patch.yml 的 config 结构一致）。 */
export interface SecurityConfig {
  /** 安全入口总开关。 */
  readonly enabled: boolean
  /** 入口监听（TLS 终止 + 认证门 + 反向代理）。 */
  readonly entry: {
    readonly host: '0.0.0.0' | '127.0.0.1'
    readonly port: number
    readonly tls: EntryTlsConfig
  }
  /** 会话策略（M1 生效）。 */
  readonly session: { readonly ttlMinutes: number }
  /** 登录限速策略（M1 生效）。 */
  readonly rateLimit: { readonly maxAttempts: number; readonly windowMinutes: number }
  /** 用户设置出厂预设（缺省回退 DEFAULT_SETTINGS）。 */
  readonly defaultSettings: unknown
  /**
   * dsh home 根目录（plugin-data 存储定位）。
   * 解析优先级：config.dshHome → $DSH_HOME → ~/.dsh。
   */
  readonly dshHome: string
}

/** 出厂默认配置（代码内兜底；部署方 patch 可整体覆盖）。 */
export const DEFAULT_CONFIG: SecurityConfig = {
  enabled: true,
  entry: {
    host: '0.0.0.0',
    port: 3443,
    tls: { certPath: null, keyPath: null },
  },
  session: { ttlMinutes: 480 },
  rateLimit: { maxAttempts: 5, windowMinutes: 15 },
  defaultSettings: undefined,
  dshHome: '',
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/**
 * 校验并规范化一份插件配置输入。
 * @param input - patch config 的原始值（unknown）。
 * @returns 规范化后的完整配置（字段缺省时取 DEFAULT_CONFIG 对应值）。
 * @throws 非法字段（错误配置大声失败）。
 */
export function normalizeConfig(input: unknown): SecurityConfig {
  if (input === undefined || input === null) return { ...DEFAULT_CONFIG, defaultSettings: undefined }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('web-security: 配置必须是对象')
  }
  const value = input as Record<string, unknown>
  const entry = (value.entry ?? {}) as Record<string, unknown>
  const session = (value.session ?? {}) as Record<string, unknown>
  const rateLimit = (value.rateLimit ?? {}) as Record<string, unknown>
  const tls = (entry.tls ?? {}) as Record<string, unknown>

  const host = entry.host === '127.0.0.1' || entry.host === '0.0.0.0'
    ? entry.host
    : entry.host === undefined
      ? DEFAULT_CONFIG.entry.host
      : (() => { throw new Error('web-security: entry.host 只允许 127.0.0.1 或 0.0.0.0') })()
  const port = entry.port === undefined
    ? DEFAULT_CONFIG.entry.port
    : isBoundedNumber(entry.port, 1, 65535)
      ? entry.port
      : (() => { throw new Error('web-security: entry.port 必须位于 1–65535') })()
  const certPath = tls.certPath === null || tls.certPath === undefined
    ? null
    : typeof tls.certPath === 'string' && tls.certPath.length > 0
      ? tls.certPath
      : (() => { throw new Error('web-security: entry.tls.certPath 必须是非空字符串或 null') })()
  const keyPath = tls.keyPath === null || tls.keyPath === undefined
    ? null
    : typeof tls.keyPath === 'string' && tls.keyPath.length > 0
      ? tls.keyPath
      : (() => { throw new Error('web-security: entry.tls.keyPath 必须是非空字符串或 null') })()
  if ((certPath === null) !== (keyPath === null)) {
    throw new Error('web-security: entry.tls.certPath 与 keyPath 必须同时提供或同时为 null')
  }

  const ttlMinutes = session.ttlMinutes === undefined
    ? DEFAULT_CONFIG.session.ttlMinutes
    : isBoundedNumber(session.ttlMinutes, 5, 60 * 24 * 30)
      ? session.ttlMinutes
      : (() => { throw new Error('web-security: session.ttlMinutes 必须位于 5–43200') })()
  const maxAttempts = rateLimit.maxAttempts === undefined
    ? DEFAULT_CONFIG.rateLimit.maxAttempts
    : isBoundedNumber(rateLimit.maxAttempts, 1, 100)
      ? rateLimit.maxAttempts
      : (() => { throw new Error('web-security: rateLimit.maxAttempts 必须位于 1–100') })()
  const windowMinutes = rateLimit.windowMinutes === undefined
    ? DEFAULT_CONFIG.rateLimit.windowMinutes
    : isBoundedNumber(rateLimit.windowMinutes, 1, 24 * 60)
      ? rateLimit.windowMinutes
      : (() => { throw new Error('web-security: rateLimit.windowMinutes 必须位于 1–1440') })()

  const enabled = value.enabled === undefined
    ? DEFAULT_CONFIG.enabled
    : typeof value.enabled === 'boolean'
      ? value.enabled
      : (() => { throw new Error('web-security: enabled 必须是布尔值') })()

  // dshHome 解析：config 显式值 → $DSH_HOME → ~/.dsh（平台约定）。
  const dshHome = typeof value.dshHome === 'string' && value.dshHome.length > 0
    ? value.dshHome
    : process.env.DSH_HOME ?? join(homedir(), '.dsh')

  return {
    enabled,
    entry: { host, port, tls: { certPath, keyPath } },
    session: { ttlMinutes },
    rateLimit: { maxAttempts, windowMinutes },
    defaultSettings: value.defaultSettings,
    dshHome,
  }
}