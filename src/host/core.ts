import { homedir } from 'node:os'
import { join } from 'node:path'
import { SETTINGS_RANGES } from '../contracts/settings'

/**
 * 插件配置规范化（部署方 patch `config` 的解析与校验）。
 *
 * 与框架无关的纯函数；`normalizeConfig` 对任意结构输入做字段级校验，
 * 非法即抛错（「错误配置大声失败」，绝不静默修正安全策略）。
 * 数值区间引用 `SETTINGS_RANGES`（contracts/settings）单一来源，
 * 与用户设置 schema 的同名字段共用同一区间，防止漂移。
 */

/** 入口 TLS 形态：certPath/keyPath 均为 null → 自签；二者齐全 → 用户证书。 */
export interface EntryTlsConfig {
  readonly certPath: string | null
  readonly keyPath: string | null
}

/**
 * 插件配置（与 cordis.patch.yml 的 config 结构一致）。
 *
 * session/rateLimit 是部署方预设层；用户设置（SecuritySettings）的同名
 * 字段是用户覆盖层——M1 的 mergeSettings 定义「用户值 → 部署预设 → 标准档」
 * 的合并优先级。
 */
export interface SecurityConfig {
  /** 安全入口总开关。 */
  readonly enabled: boolean
  /** 入口监听（TLS 终止 + 认证门 + 反向代理）。 */
  readonly entry: {
    readonly host: '0.0.0.0' | '127.0.0.1'
    readonly port: number
    readonly tls: EntryTlsConfig
    /** TLS 模式：'https'（用户证书）| 'http'（明文，开发/测试用）。 */
    readonly tlsMode: 'https' | 'http'
  }
  /** 上游 dsh 宿主地址（反向代理目标）。 */
  readonly upstream: {
    readonly host: string
    readonly port: number
  }
  /** 会话策略预设（M1 生效）。 */
  readonly session: { readonly ttlMinutes: number }
  /** 登录限速策略预设（M1 生效）。 */
  readonly rateLimit: { readonly maxAttempts: number; readonly windowMinutes: number }
  /** 用户设置出厂预设（缺省回退 DEFAULT_SETTINGS）。 */
  readonly defaultSettings: unknown
  /**
   * dsh home 根目录（plugin-data 存储定位的唯一解析点）。
   * 优先级：config.dshHome → $DSH_HOME → ~/.dsh。normalizeConfig 必然填充。
   */
  readonly dshHome: string
  /**
   * WebAuthn RP ID（M3 passkey 用；部署域名根，如 'sec.example.com'）。
   * M1 预留，缺省为空串（passkey 未启用）。
   */
  readonly rpID: string
}

/** 出厂默认配置（代码内兜底；部署方 patch 可整体覆盖）。 */
export const DEFAULT_CONFIG: SecurityConfig = {
  enabled: true,
  entry: {
    host: '0.0.0.0',
    port: 3443,
    tls: { certPath: null, keyPath: null },
    tlsMode: 'http',
  },
  upstream: { host: '127.0.0.1', port: 3080 },
  session: { ttlMinutes: 480 },
  rateLimit: { maxAttempts: 5, windowMinutes: 15 },
  defaultSettings: undefined,
  // 仅类型占位：normalizeConfig 的每个返回分支都会填入真实解析值。
  dshHome: '',
  // M1 预留：M3 passkey 用；缺省空串（未启用）。
  rpID: '',
}

/** 枚举校验：不在白名单即抛错；undefined 回退默认值。 */
function requireEnum<T extends string>(
  value: unknown, allowed: readonly T[], fallback: T, label: string,
): T {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T
  }
  throw new Error(`web-security: ${label} 只允许 ${allowed.join(' / ')}`)
}

/** 有界数值校验：越界或非数字即抛错；undefined 回退默认值。 */
function requireBoundedNumber(
  value: unknown, min: number, max: number, fallback: number, label: string,
): number {
  if (value === undefined) return fallback
  if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
    return value
  }
  throw new Error(`web-security: ${label} 必须位于 ${min}–${max}`)
}

/** 布尔校验：非布尔即抛错；undefined 回退默认值。 */
function requireBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new Error(`web-security: ${label} 必须是布尔值`)
}

/** 可空非空字符串校验（TLS 路径形态）；null/undefined 归一为 null。 */
function requireOptionalPath(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`web-security: ${label} 必须是非空字符串或 null`)
}

/**
 * 校验并规范化一份插件配置输入。
 * @param input - patch config 的原始值（unknown）；undefined/null 视为未配置。
 * @returns 规范化后的完整配置（字段缺省时取 DEFAULT_CONFIG 对应值）。
 * @throws 非法字段（错误配置大声失败）。
 */
export function normalizeConfig(input: unknown): SecurityConfig {
  // undefined/null 与 {} 同路：所有字段走统一的缺省与校验逻辑，
  // 保证 dshHome 等运行时解析字段在「未配置」时同样被填充。
  if (input !== null && input !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('web-security: 配置必须是对象')
  }
  const value = (input ?? {}) as Record<string, unknown>
  const entry = (value.entry ?? {}) as Record<string, unknown>
  const session = (value.session ?? {}) as Record<string, unknown>
  const rateLimit = (value.rateLimit ?? {}) as Record<string, unknown>
  const tls = (entry.tls ?? {}) as Record<string, unknown>
  const upstream = (value.upstream ?? {}) as Record<string, unknown>

  const host = requireEnum(entry.host, ['127.0.0.1', '0.0.0.0'] as const,
    DEFAULT_CONFIG.entry.host, 'entry.host')
  const port = requireBoundedNumber(entry.port, 1, 65535,
    DEFAULT_CONFIG.entry.port, 'entry.port')
  const certPath = requireOptionalPath(tls.certPath, 'entry.tls.certPath')
  const keyPath = requireOptionalPath(tls.keyPath, 'entry.tls.keyPath')
  if ((certPath === null) !== (keyPath === null)) {
    throw new Error('web-security: entry.tls.certPath 与 keyPath 必须同时提供或同时为 null')
  }
  // tlsMode：有证书 → 'https'；无证书 → 'http'（可被 entry.tlsMode 显式覆盖）。
  const tlsMode = requireEnum(entry.tlsMode, ['https', 'http'] as const,
    certPath !== null ? 'https' : 'http', 'entry.tlsMode')
  if (tlsMode === 'https' && certPath === null) {
    throw new Error('web-security: entry.tlsMode=https 但未提供 certPath/keyPath')
  }

  // upstream：缺省回退 DEFAULT_CONFIG（127.0.0.1:3080）。
  const upstreamHost = typeof upstream.host === 'string' && upstream.host.length > 0
    ? upstream.host
    : DEFAULT_CONFIG.upstream.host
  const upstreamPort = requireBoundedNumber(upstream.port, 1, 65535,
    DEFAULT_CONFIG.upstream.port, 'upstream.port')

  const ttlRange = SETTINGS_RANGES.sessionTtlMinutes
  const ttlMinutes = requireBoundedNumber(session.ttlMinutes, ttlRange.min, ttlRange.max,
    DEFAULT_CONFIG.session.ttlMinutes, 'session.ttlMinutes')
  const attemptsRange = SETTINGS_RANGES.maxLoginAttempts
  const maxAttempts = requireBoundedNumber(rateLimit.maxAttempts, attemptsRange.min, attemptsRange.max,
    DEFAULT_CONFIG.rateLimit.maxAttempts, 'rateLimit.maxAttempts')
  const windowRange = SETTINGS_RANGES.rateLimitWindowMinutes
  const windowMinutes = requireBoundedNumber(rateLimit.windowMinutes, windowRange.min, windowRange.max,
    DEFAULT_CONFIG.rateLimit.windowMinutes, 'rateLimit.windowMinutes')

  const enabled = requireBoolean(value.enabled, DEFAULT_CONFIG.enabled, 'enabled')

  // dshHome 解析唯一入口：config 显式值 → $DSH_HOME → ~/.dsh（平台约定）。
  // 空串 env 视为未设置（|| 兜底），与「缺省即默认」语义一致。
  const dshHome = typeof value.dshHome === 'string' && value.dshHome.length > 0
    ? value.dshHome
    : process.env.DSH_HOME || join(homedir(), '.dsh')

  return {
    enabled,
    entry: { host, port, tls: { certPath, keyPath }, tlsMode },
    upstream: { host: upstreamHost, port: upstreamPort },
    session: { ttlMinutes },
    rateLimit: { maxAttempts, windowMinutes },
    defaultSettings: value.defaultSettings,
    dshHome,
    rpID: typeof value.rpID === 'string' && value.rpID.length > 0 ? value.rpID : '',
  }
}
