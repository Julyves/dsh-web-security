/**
 * IP 维度限速器：入口层 IP + 全局失败计数 + 指数退避。
 *
 * 与框架无关的纯逻辑模块。审计 S2 限速分层：
 * - M1 端点层：username 维度（rate-limiter.ts）
 * - M2 入口层：IP 维度（本模块——防分布式爆破）
 *
 * 结构与 rate-limiter 相同，但 key 是 IP 地址。
 */

import type { LoginGate } from '../contracts/auth-events'

interface FailureEntry {
  failures: number
  firstFailAt: number
  lockedUntil: number
  lockoutCount: number
}

const BASE_LOCKOUT_MS = 60_000
const MAX_LOCKOUT_MS = 3_600_000

/**
 * 创建 IP 维度限速器。
 * @param maxAttempts - 窗口内允许的失败次数。
 * @param windowMs - 失败窗口（ms）。
 */
/** Map 条目上限（防内存泄漏 DoS——审计 V29）。 */
const MAX_ENTRIES = 10_000

export function createIpRateLimiter(maxAttempts: number, windowMs: number): {
  gate: (ip: string) => LoginGate
  recordFailure: (ip: string) => void
  recordSuccess: (ip: string) => void
} {
  const entries = new Map<string, FailureEntry>()
  const now = (): number => Date.now()

  function get(ip: string): FailureEntry {
    let entry = entries.get(ip)
    if (entry === undefined) {
      // LRU 淘汰：Map 超上限时删除最旧 key（Map 保持插入序）。
      if (entries.size >= MAX_ENTRIES) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      entry = { failures: 0, firstFailAt: 0, lockedUntil: 0, lockoutCount: 0 }
      entries.set(ip, entry)
    }
    return entry
  }

  function gate(ip: string): LoginGate {
    const entry = get(ip)
    const t = now()
    if (entry.firstFailAt !== 0 && t - entry.firstFailAt > windowMs) {
      entry.failures = 0
      entry.firstFailAt = 0
      entry.lockedUntil = 0
    }
    if (entry.lockedUntil > t) {
      return { state: 'locked', retryAfterMs: entry.lockedUntil - t }
    }
    // 锁定过期后 lockoutCount 衰减（防永久锁定 DoS——审计 V9）。
    if (entry.lockoutCount > 0 && entry.lockedUntil !== 0 && entry.lockedUntil <= t) {
      entry.lockoutCount = Math.floor(entry.lockoutCount / 2)
      if (entry.lockoutCount === 0) entry.lockedUntil = 0
    }
    return { state: 'allowed' }
  }

  function recordFailure(ip: string): void {
    const entry = get(ip)
    const t = now()
    if (entry.firstFailAt !== 0 && t - entry.firstFailAt > windowMs) {
      entry.failures = 0
      entry.firstFailAt = t
    }
    if (entry.firstFailAt === 0) entry.firstFailAt = t
    entry.failures += 1
    if (entry.failures >= maxAttempts) {
      entry.lockoutCount += 1
      const lockoutMs = Math.min(BASE_LOCKOUT_MS * (2 ** (entry.lockoutCount - 1)), MAX_LOCKOUT_MS)
      entry.lockedUntil = t + lockoutMs
    }
  }

  function recordSuccess(ip: string): void {
    entries.delete(ip)
  }

  return { gate, recordFailure, recordSuccess }
}
