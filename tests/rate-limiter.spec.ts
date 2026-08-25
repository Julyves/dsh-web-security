/**
 * rate-limiter 纯函数单测。
 *
 * 覆盖：允许/锁定/指数退避递增/上限/窗口过期重置/成功重置。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from '../src/host/rate-limiter'
import type { LoginGate } from '../src/contracts/auth-events'

describe('createRateLimiter', () => {
  it('初始状态放行', () => {
    const rl = createRateLimiter(3, 60_000)
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
  })

  it('未达阈值放行', () => {
    const rl = createRateLimiter(3, 60_000)
    rl.recordFailure('user')
    rl.recordFailure('user')
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
  })

  it('达到阈值锁定并返回剩余时间', () => {
    const rl = createRateLimiter(3, 60_000)
    rl.recordFailure('user')
    rl.recordFailure('user')
    rl.recordFailure('user')
    const result = rl.gate('user') as Extract<LoginGate, { state: 'locked' }>
    expect(result.state).toBe('locked')
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it('指数退避递增：首次 60s → 120s → 240s', () => {
    const rl = createRateLimiter(3, 60_000)
    // 第 1 次锁定
    for (let i = 0; i < 3; i++) rl.recordFailure('user')
    let r = rl.gate('user') as Extract<LoginGate, { state: 'locked' }>
    expect(r.retryAfterMs).toBeGreaterThan(50_000)
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000)

    // 第 2 次锁定（继续失败）
    vi.setSystemTime(Date.now() + 65_000) // 过了首次锁定
    rl.recordFailure('user')
    rl.recordFailure('user')
    rl.recordFailure('user')
    r = rl.gate('user') as Extract<LoginGate, { state: 'locked' }>
    expect(r.retryAfterMs).toBeGreaterThan(110_000)
    expect(r.retryAfterMs).toBeLessThanOrEqual(120_000)

    // 第 3 次锁定
    vi.setSystemTime(Date.now() + 130_000)
    for (let i = 0; i < 3; i++) rl.recordFailure('user')
    r = rl.gate('user') as Extract<LoginGate, { state: 'locked' }>
    expect(r.retryAfterMs).toBeGreaterThan(230_000)
    expect(r.retryAfterMs).toBeLessThanOrEqual(240_000)
  })

  it('指数退避上限 1 小时', () => {
    const rl = createRateLimiter(3, 60_000)
    // 模拟 20 次锁定（远超上限）
    for (let lockRound = 0; lockRound < 20; lockRound++) {
      vi.setSystemTime(lockRound * 100_000)
      for (let i = 0; i < 3; i++) rl.recordFailure('user')
    }
    const r = rl.gate('user') as Extract<LoginGate, { state: 'locked' }>
    expect(r.retryAfterMs).toBeLessThanOrEqual(3_600_000)
  })

  it('窗口过期后重置计数', () => {
    const rl = createRateLimiter(3, 60_000)
    rl.recordFailure('user')
    rl.recordFailure('user')
    vi.setSystemTime(Date.now() + 61_000) // 窗口过期
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
    rl.recordFailure('user') // 重新计数
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
  })

  it('成功后重置计数', () => {
    const rl = createRateLimiter(3, 60_000)
    rl.recordFailure('user')
    rl.recordFailure('user')
    rl.recordSuccess('user')
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
    // 重置后从 0 开始
    rl.recordFailure('user')
    expect(rl.gate('user')).toEqual({ state: 'allowed' })
  })

  it('不同用户名独立计数', () => {
    const rl = createRateLimiter(3, 60_000)
    rl.recordFailure('user1')
    rl.recordFailure('user1')
    rl.recordFailure('user1')
    expect(rl.gate('user1').state).toBe('locked')
    expect(rl.gate('user2')).toEqual({ state: 'allowed' })
  })
})
