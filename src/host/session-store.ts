/**
 * 会话存储：内存会话表 + cookie 签发/解析 + 滑动续期 + 单会话默认。
 *
 * 与框架无关的纯内存模块。安全特性：
 * - token 熵 256 bit（randomBytes(32) → base64url）；
 * - 重启失效（内存态，安全默认——迫使重新登录）；
 * - 单会话默认（create 时撤销同 username 旧会话——审计 M3）；
 * - 滑动续期（resolve 时更新 lastAccessAt）。
 */

import { randomBytes } from 'node:crypto'

/** 会话 cookie 名。 */
export const SESSION_COOKIE_NAME = 'dsh_web_security_session'

/** 一条会话条目。 */
export interface SessionEntry {
  readonly token: string
  readonly username: string
  readonly createdAt: number
  lastAccessAt: number
  readonly ip: string
}

/**
 * 创建会话存储。
 * @param ttlMinutes - 会话 TTL（分钟）；超过后惰性清理。
 * @param secureCookie - cookie 是否带 Secure 标志（https=true；http 开发模式
 *   必须为 false——Secure cookie 在明文页面被浏览器拒绝存储，审计 X6）。
 */
export function createSessionStore(ttlMinutes: number, secureCookie = true): {
  create: (username: string, ip: string) => { token: string; cookie: string }
  resolve: (token: string) => SessionEntry | undefined
  revoke: (token: string) => void
  /** 撤销某用户全部活跃会话（账号删除联动——M4）。 */
  revokeAllForUser: (username: string) => void
  sweep: () => void
} {
  const ttlMs = ttlMinutes * 60_000
  /** token → 会话条目。 */
  const sessions = new Map<string, SessionEntry>()
  /** username → 该用户的活跃 token（单会话默认：新登录覆盖旧 token）。 */
  const userTokens = new Map<string, string>()

  const now = (): number => Date.now()

  function create(username: string, ip: string): { token: string; cookie: string } {
    const t = now()
    // 单会话默认（审计 M3）：撤销同 username 的旧会话。
    const oldToken = userTokens.get(username)
    if (oldToken !== undefined) {
      sessions.delete(oldToken)
    }
    const token = randomBytes(32).toString('base64url')
    const entry: SessionEntry = {
      token, username, createdAt: t, lastAccessAt: t, ip,
    }
    sessions.set(token, entry)
    userTokens.set(username, token)
    const securePart = secureCookie ? ' Secure;' : ''
    const cookie = `${SESSION_COOKIE_NAME}=${token}; HttpOnly;${securePart} SameSite=Strict; Path=/; Max-Age=${ttlMinutes * 60}`
    return { token, cookie }
  }

  function resolve(token: string): SessionEntry | undefined {
    const entry = sessions.get(token)
    if (entry === undefined) return undefined
    const t = now()
    // TTL 过期 → 清理。
    if (t - entry.lastAccessAt > ttlMs) {
      sessions.delete(token)
      userTokens.delete(entry.username)
      return undefined
    }
    // 滑动续期。
    entry.lastAccessAt = t
    return entry
  }

  function revoke(token: string): void {
    const entry = sessions.get(token)
    if (entry !== undefined) {
      sessions.delete(token)
      userTokens.delete(entry.username)
    }
  }

  /** 撤销某用户全部活跃会话（账号删除联动——M4）。 */
  function revokeAllForUser(username: string): void {
    const token = userTokens.get(username)
    if (token !== undefined) {
      sessions.delete(token)
      userTokens.delete(username)
    }
  }

  function sweep(): void {
    const t = now()
    for (const [token, entry] of sessions) {
      if (t - entry.lastAccessAt > ttlMs) {
        sessions.delete(token)
        userTokens.delete(entry.username)
      }
    }
  }

  return { create, resolve, revoke, revokeAllForUser, sweep }
}

/**
 * 从 Cookie 头解析会话 token。
 * @param cookieHeader - HTTP Cookie 头原始值。
 * @returns token 或 undefined。
 */
export function parseSessionToken(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq > 0 && trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = trimmed.slice(eq + 1)
      // 长度限制：base64url(32 bytes) = 43 chars，允许 ±5 容差（防超长 DoS——审计 V7）。
      if (value.length < 38 || value.length > 128) return undefined
      return value
    }
  }
  return undefined
}
