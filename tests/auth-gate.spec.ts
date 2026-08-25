/**
 * auth-gate 单测：路径规则 + cookie 解析 + 会话校验。
 */
import { describe, expect, it } from 'vitest'
import { createAuthGate } from '../src/host/auth-gate'
import { createSessionStore, SESSION_COOKIE_NAME } from '../src/host/session-store'

describe('createAuthGate', () => {
  it('受保护路径无 cookie 返回未认证', () => {
    const sessions = createSessionStore(480)
    const gate = createAuthGate({ resolveSession: (t) => {
      const e = sessions.resolve(t)
      return e === undefined ? undefined : { username: e.username }
    } })
    expect(gate.check(undefined, '/api/test')).toEqual({ authenticated: false })
    expect(gate.check('', '/api/test')).toEqual({ authenticated: false })
  })

  it('受保护路径有有效 cookie 返回已认证', () => {
    const sessions = createSessionStore(480)
    const { cookie } = sessions.create('admin', '127.0.0.1')
    const gate = createAuthGate({ resolveSession: (t) => {
      const e = sessions.resolve(t)
      return e === undefined ? undefined : { username: e.username }
    } })
    const result = gate.check(cookie, '/api/test')
    expect(result.authenticated).toBe(true)
    expect(result.username).toBe('admin')
  })

  it('无效 cookie（token 不存在）返回未认证', () => {
    const sessions = createSessionStore(480)
    const gate = createAuthGate({ resolveSession: (t) => {
      const e = sessions.resolve(t)
      return e === undefined ? undefined : { username: e.username }
    } })
    const cookie = `${SESSION_COOKIE_NAME}=invalidtoken123456789012345678901234567890123`
    expect(gate.check(cookie, '/api/test')).toEqual({ authenticated: false })
  })

  it('/security/* 公开路径无 cookie 也放行（authenticated=false）', () => {
    const sessions = createSessionStore(480)
    const gate = createAuthGate({ resolveSession: (t) => {
      const e = sessions.resolve(t)
      return e === undefined ? undefined : { username: e.username }
    } })
    const result = gate.check(undefined, '/security/login')
    expect(result.authenticated).toBe(false)
  })

  it('/security/* 公开路径有有效 cookie 返回已认证（登录页显示登出按钮用）', () => {
    const sessions = createSessionStore(480)
    const { cookie } = sessions.create('admin', '127.0.0.1')
    const gate = createAuthGate({ resolveSession: (t) => {
      const e = sessions.resolve(t)
      return e === undefined ? undefined : { username: e.username }
    } })
    const result = gate.check(cookie, '/security/login')
    expect(result.authenticated).toBe(true)
    expect(result.username).toBe('admin')
  })
})
