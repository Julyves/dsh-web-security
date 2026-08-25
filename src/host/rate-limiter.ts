/**
 * 登录限速器：username 维度失败计数 + 指数退避锁定。
 *
 * 与框架无关的纯逻辑模块。审计约束（S2）：typert 端点无法获取客户端 IP，
 * IP 维度限速归 M2 代理层；本模块只做 username 维度。
 *
 * 策略：windowMs 内 maxAttempts 次失败 → 锁定，指数退避
 * （首次 60s，逐次翻倍，上限 3600s = 1h）。
 */

import type { LoginGate } from '../contracts/auth-events'

/** 一次失败计数条目。 */
interface FailureEntry {
  /** 窗口内失败次数。 */
  failures: number
  /** 首次失败时间戳（epoch ms）。 */
  firstFailAt: number
  /** 锁定截止时间戳（0 = 未锁定）。 */
  lockedUntil: number
  /** 历史锁定次数（跨窗口累计，仅在 recordSuccess 时清零——驱动指数退避）。 */
  lockoutCount: number
}

/** 锁定基准（ms）与上限。 */
const BASE_LOCKOUT_MS = 60_000
const MAX_LOCKOUT_MS = 3_600_000

/**
 * 创建 username 维度限速器。
 * @param maxAttempts - 窗口内允许的失败次数。
 * @param windowMs - 失败窗口（ms）。
 */
export function createRateLimiter(maxAttempts: number, windowMs: number): {
  gate: (username: string) => LoginGate
  recordFailure: (username: string) => void
  recordSuccess: (username: string) => void
} {
  const entries = new Map<string, FailureEntry>()

  const now = (): number => Date.now()

  function get(username: string): FailureEntry {
    let entry = entries.get(username)
    if (entry === undefined) {
      entry = { failures: 0, firstFailAt: 0, lockedUntil: 0, lockoutCount: 0 }
      entries.set(username, entry)
    }
    return entry
  }

  function gate(username: string): LoginGate {
    const entry = get(username)
    const t = now()
    // 窗口过期 → 重置计数。
    if (entry.firstFailAt !== 0 && t - entry.firstFailAt > windowMs) {
      entry.failures = 0
      entry.firstFailAt = 0
      entry.lockedUntil = 0
    }
    if (entry.lockedUntil > t) {
      return { state: 'locked', retryAfterMs: entry.lockedUntil - t }
    }
    // 锁定已过期 → lockoutCount 衰减（防永久锁定 DoS——审计 V9）：
    // 每次锁定过期后减半，允许合法用户在安静期后恢复。
    if (entry.lockoutCount > 0 && entry.lockedUntil !== 0 && entry.lockedUntil <= t) {
      entry.lockoutCount = Math.floor(entry.lockoutCount / 2)
      if (entry.lockoutCount === 0) entry.lockedUntil = 0
    }
    return { state: 'allowed' }
  }

  function recordFailure(username: string): void {
    const entry = get(username)
    const t = now()
    // 窗口过期 → 重置。
    if (entry.firstFailAt !== 0 && t - entry.firstFailAt > windowMs) {
      entry.failures = 0
      entry.firstFailAt = t
    }
    if (entry.firstFailAt === 0) entry.firstFailAt = t
    entry.failures += 1
    if (entry.failures >= maxAttempts) {
      // 指数退避：第 n 次锁定 = min(BASE * 2^(n-1), MAX)。
      // lockoutCount 跨窗口累计，仅在 recordSuccess 时清零。
      entry.lockoutCount += 1
      const lockoutMs = Math.min(BASE_LOCKOUT_MS * (2 ** (entry.lockoutCount - 1)), MAX_LOCKOUT_MS)
      entry.lockedUntil = t + lockoutMs
    }
  }

  function recordSuccess(username: string): void {
    entries.delete(username)
  }

  return { gate, recordFailure, recordSuccess }
}
