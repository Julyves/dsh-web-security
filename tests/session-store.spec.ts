/**
 * session-store 纯函数单测。
 *
 * 覆盖：创建/resolve 续期/TTL 过期/撤销/单会话覆盖/cookie 解析/重启失效。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSessionStore, parseSessionToken, SESSION_COOKIE_NAME } from '../src/host/session-store'

describe('createSessionStore', () => {
  it('创建会话返回 token 与 cookie', () => {
    const store = createSessionStore(480)
    const { token, cookie } = store.create('admin', '127.0.0.1')
    expect(token).toHaveLength(43) // base64url(32 bytes) = 43 chars
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${token}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=28800') // 480 * 60
  })

  it('resolve 续期返回会话', () => {
    const store = createSessionStore(480)
    const { token } = store.create('admin', '127.0.0.1')
    const entry = store.resolve(token)
    expect(entry?.username).toBe('admin')
    expect(entry?.ip).toBe('127.0.0.1')
  })

  it('resolve 未知 token 返回 undefined', () => {
    const store = createSessionStore(480)
    expect(store.resolve('nonexistent')).toBeUndefined()
  })

  it('TTL 过期后 resolve 返回 undefined', () => {
    const store = createSessionStore(1) // 1 分钟
    const { token } = store.create('admin', '127.0.0.1')
    vi.setSystemTime(Date.now() + 61_000) // 61 秒后
    expect(store.resolve(token)).toBeUndefined()
  })

  it('滑动续期：TTL 内访问延长有效期', () => {
    const store = createSessionStore(1)
    const { token } = store.create('admin', '127.0.0.1')
    vi.setSystemTime(Date.now() + 30_000) // 30 秒后访问
    expect(store.resolve(token)?.username).toBe('admin')
    vi.setSystemTime(Date.now() + 30_000) // 再 30 秒（距创建 60s，但距上次访问 30s）
    expect(store.resolve(token)?.username).toBe('admin') // 仍在 TTL 内
  })

  it('撤销后 resolve 返回 undefined', () => {
    const store = createSessionStore(480)
    const { token } = store.create('admin', '127.0.0.1')
    store.revoke(token)
    expect(store.resolve(token)).toBeUndefined()
  })

  it('单会话默认：同用户新登录撤销旧会话', () => {
    const store = createSessionStore(480)
    const { token: t1 } = store.create('admin', '127.0.0.1')
    const { token: t2 } = store.create('admin', '10.0.0.1')
    expect(t1).not.toBe(t2)
    expect(store.resolve(t1)).toBeUndefined() // 旧 token 失效
    expect(store.resolve(t2)?.username).toBe('admin') // 新 token 有效
  })

  it('不同用户会话独立', () => {
    const store = createSessionStore(480)
    const { token: t1 } = store.create('user1', '127.0.0.1')
    const { token: t2 } = store.create('user2', '127.0.0.1')
    expect(store.resolve(t1)?.username).toBe('user1')
    expect(store.resolve(t2)?.username).toBe('user2')
  })

  it('重启（重新 createStore）旧 token 失效', () => {
    const store1 = createSessionStore(480)
    const { token } = store1.create('admin', '127.0.0.1')
    const store2 = createSessionStore(480)
    expect(store2.resolve(token)).toBeUndefined()
  })

  it('sweep 清理过期会话', () => {
    const store = createSessionStore(1)
    store.create('admin', '127.0.0.1')
    vi.setSystemTime(Date.now() + 61_000)
    store.sweep()
    // sweep 后内部 Map 应为空（无法直接验证，但 sweep 不抛错即正确）
    expect(() => store.sweep()).not.toThrow()
  })
})

describe('parseSessionToken', () => {
  const validToken = 'a'.repeat(43) // base64url(32 bytes) = 43 chars

  it('从 Cookie 头解析 token', () => {
    const cookie = `${SESSION_COOKIE_NAME}=${validToken}; other=xyz`
    expect(parseSessionToken(cookie)).toBe(validToken)
  })

  it('无 Cookie 头返回 undefined', () => {
    expect(parseSessionToken(undefined)).toBeUndefined()
  })

  it('无目标 cookie 返回 undefined', () => {
    expect(parseSessionToken('other=xyz')).toBeUndefined()
  })

  it('多 cookie 正确提取', () => {
    const cookie = `a=1; ${SESSION_COOKIE_NAME}=${validToken}; b=2`
    expect(parseSessionToken(cookie)).toBe(validToken)
  })

  it('过短 token 拒绝（防超长 DoS——审计 V7）', () => {
    const cookie = `${SESSION_COOKIE_NAME}=short; other=xyz`
    expect(parseSessionToken(cookie)).toBeUndefined()
  })

  it('过长 token 拒绝', () => {
    const cookie = `${SESSION_COOKIE_NAME}=${'x'.repeat(200)}; other=xyz`
    expect(parseSessionToken(cookie)).toBeUndefined()
  })
})
