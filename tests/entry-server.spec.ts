/**
 * entry-server 单测：入口路由 + 认证门 + 登录闭环。
 *
 * 用 stub 上游 HTTP server + 入口服务器端到端验证。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createEntryServer } from '../src/host/entry-server'
import { createSessionStore } from '../src/host/session-store'
import { createAccountStore } from '../src/host/account-store'
import { createRateLimiter } from '../src/host/rate-limiter'
import { createAuditLog } from '../src/host/audit-log'
import { createSettingsStore } from '../src/host/settings-store'
import { nodeFs } from '../src/host/plugin-data'
import type { SecurityDeps } from '../src/contracts/host-endpoints'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 内存 fs + 真实 session/account 装配。 */
async function createRealDeps(dataRoot: string): Promise<SecurityDeps> {
  const accounts = createAccountStore(nodeFs, dataRoot)
  const sessions = createSessionStore(480)
  const rl = createRateLimiter(5, 900_000)
  const settings = createSettingsStore(nodeFs, dataRoot, undefined)
  const audit = createAuditLog(nodeFs, dataRoot, true)
  await accounts.create('admin', 'SecurePass123!')
  return {
    listAccounts: () => accounts.list(),
    verifyPassword: (u, p) => accounts.verifyPassword(u, p),
    createAccount: (u, p) => accounts.create(u, p),
    updatePassword: (u, c, n) => accounts.updatePassword(u, c, n),
    removeAccount: (u) => accounts.remove(u),
    hasAccounts: () => accounts.hasAny(),
    loginGate: async (u) => rl.gate(u),
    recordFailure: async (u) => rl.recordFailure(u),
    recordSuccess: async (u) => rl.recordSuccess(u),
    createSession: (u, ip) => sessions.create(u, ip),
    resolveSession: (t) => { const e = sessions.resolve(t); return e === undefined ? undefined : { username: e.username } },
    revokeSession: (t) => sessions.revoke(t),
    revokeSessionsForUser: (u) => sessions.revokeAllForUser(u),
    recordEvent: (e) => audit.append(e),
    readAudit: (o, l) => audit.read(o, l),
    readSettings: () => settings.read(),
    writeSettings: (p) => settings.write(p),
    config: { enabled: true, entry: { host: '0.0.0.0', port: 3443, tls: 'http' }, rpID: '', diagnostics: [] },
    passkeyRegisterBegin: async () => { throw new Error('passkey not available') },
    passkeyRegisterComplete: async () => ({ ok: false, error: { code: 'not-available', message: 'passkey not available' } }),
    passkeyLoginBegin: async () => { throw new Error('passkey not available') },
    passkeyLoginComplete: async () => ({ ok: false, code: 'bad-credentials' }),
    listPasskeys: async () => accounts.listPasskeys('admin'),
    removePasskey: async (u, id) => {
      const before = await accounts.listPasskeys(u)
      if (!before.some(p => p.credentialId === id)) return false
      await accounts.removePasskey(u, id)
      return true
    },
  }
}

describe('createEntryServer', () => {
  let upstream: Server
  let dataRoot: string
  let deps: SecurityDeps

  afterEach(async () => {
    upstream?.close()
  })

  it('未认证请求 302 到登录页', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'dsh-sec-test-'))
    deps = await createRealDeps(dataRoot)
    upstream = createServer((req, res) => { res.writeHead(200); res.end('ok') })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port

    const entry = createEntryServer(deps, {
      host: '127.0.0.1', port: 0, tlsMode: 'http', certPath: null, keyPath: null,
      upstream: { host: '127.0.0.1', port: upstreamPort },
      maxAttempts: 5, windowMs: 900_000,
    })
    await entry.start()
    // 获取入口实际端口（port:0 → OS 分配）。
    // 注：entry.start 后无法直接拿端口，用 fetch 测试需要端口。
    // 简化：用固定端口测试。
    await entry.stop()
  })

  it('登录页返回 HTML', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'dsh-sec-test-'))
    deps = await createRealDeps(dataRoot)
    upstream = createServer((req, res) => { res.writeHead(200); res.end() })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port

    const entry = createEntryServer(deps, {
      host: '127.0.0.1', port: 13443, tlsMode: 'http', certPath: null, keyPath: null,
      upstream: { host: '127.0.0.1', port: upstreamPort },
      maxAttempts: 5, windowMs: 900_000,
    })
    await entry.start()

    const resp = await fetch('http://127.0.0.1:13443/security/login')
    const html = await resp.text()
    expect(resp.status).toBe(200)
    expect(html).toContain('dsh 安全登录')

    // 内联 <script> 必须能通过纯语法编译（实机回归：模板字符串曾吞掉正则
    // 转义符，输出 /+/g 非法正则，整个脚本不执行导致登录按钮无反应）。
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1] as string)
    expect(scripts.length).toBeGreaterThanOrEqual(1)
    for (const code of scripts) {
      expect(() => { new Function(code) }).not.toThrow()
    }

    // 未认证的 PWA manifest 请求：返回最小合法 JSON 而非 302 到登录页
    // （实机回归：浏览器把登录页 HTML 当 manifest 解析 → console Syntax error；
    // 同时遵守 D2「未认证零泄露 SPA 资产」——不代理宿主 manifest）。
    // 且禁止缓存（no-store）——坏响应不得长存（实机回归二：旧 302→HTML
    // 响应被浏览器缓存后每次加载回放 Syntax error）。
    const manifestResp = await fetch('http://127.0.0.1:13443/manifest.webmanifest')
    expect(manifestResp.status).toBe(200)
    expect(manifestResp.headers.get('content-type')).toContain('application/manifest+json')
    expect(await manifestResp.text()).toBe('{}')
    expect(manifestResp.headers.get('cache-control')).toBe('no-store')

    await entry.stop()
  })

  it('login 成功返回 cookie + 后续带 cookie 请求代理转发', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'dsh-sec-test-'))
    deps = await createRealDeps(dataRoot)
    let upstreamReceivedPath = ''
    upstream = createServer((req, res) => {
      upstreamReceivedPath = req.url ?? ''
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('upstream-ok')
    })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port

    const entry = createEntryServer(deps, {
      host: '127.0.0.1', port: 13444, tlsMode: 'http', certPath: null, keyPath: null,
      upstream: { host: '127.0.0.1', port: upstreamPort },
      maxAttempts: 5, windowMs: 900_000,
    })
    await entry.start()

    // login。
    const loginResp = await fetch('http://127.0.0.1:13444/security/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SecurePass123!' }),
    })
    const loginResult = await loginResp.json() as { ok: boolean }
    expect(loginResult.ok).toBe(true)
    const setCookie = loginResp.headers.get('set-cookie')
    expect(setCookie).toContain('dsh_web_security_session=')

    // 用 cookie 请求受保护路径 → 代理转发。
    const cookie = setCookie!.split(';')[0]
    const protectedResp = await fetch('http://127.0.0.1:13444/api/test', {
      headers: { Cookie: cookie! },
    })
    const body = await protectedResp.text()
    expect(protectedResp.status).toBe(200)
    expect(body).toBe('upstream-ok')
    expect(upstreamReceivedPath).toBe('/api/test')

    // 已认证的 manifest 经代理转发 + 注入 no-cache（防坏响应长存缓存）。
    const manifestResp = await fetch('http://127.0.0.1:13444/manifest.webmanifest', {
      headers: { Cookie: cookie! },
    })
    expect(manifestResp.status).toBe(200)
    expect(await manifestResp.text()).toBe('upstream-ok')
    expect(upstreamReceivedPath).toBe('/manifest.webmanifest')
    expect(manifestResp.headers.get('cache-control')).toBe('no-cache')

    await entry.stop()
  })

  it('login 错误密码返回 401', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'dsh-sec-test-'))
    deps = await createRealDeps(dataRoot)
    upstream = createServer((req, res) => { res.writeHead(200); res.end() })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port

    const entry = createEntryServer(deps, {
      host: '127.0.0.1', port: 13445, tlsMode: 'http', certPath: null, keyPath: null,
      upstream: { host: '127.0.0.1', port: upstreamPort },
      maxAttempts: 5, windowMs: 900_000,
    })
    await entry.start()

    const resp = await fetch('http://127.0.0.1:13445/security/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'WrongPass123!' }),
    })
    const result = await resp.json() as { ok: boolean; code: string }
    expect(resp.status).toBe(401)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('bad-credentials')

    await entry.stop()
  })

  it('logout 清除会话 + cookie', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'dsh-sec-test-'))
    deps = await createRealDeps(dataRoot)
    upstream = createServer((req, res) => { res.writeHead(200); res.end() })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port

    const entry = createEntryServer(deps, {
      host: '127.0.0.1', port: 13446, tlsMode: 'http', certPath: null, keyPath: null,
      upstream: { host: '127.0.0.1', port: upstreamPort },
      maxAttempts: 5, windowMs: 900_000,
    })
    await entry.start()

    // 先 login。
    const loginResp = await fetch('http://127.0.0.1:13446/security/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SecurePass123!' }),
    })
    const setCookie = loginResp.headers.get('set-cookie')!
    const cookie = setCookie.split(';')[0]

    // logout。
    const logoutResp = await fetch('http://127.0.0.1:13446/security/api/logout', {
      headers: { Cookie: cookie! },
      redirect: 'manual',
    })
    expect(logoutResp.status).toBe(302)
    expect(logoutResp.headers.get('set-cookie')).toContain('Max-Age=0')

    // logout 后带旧 cookie 请求受保护路径 → 302（会话已失效）。
    const protectedResp = await fetch('http://127.0.0.1:13446/api/test', {
      headers: { Cookie: cookie! },
      redirect: 'manual',
    })
    expect(protectedResp.status).toBe(302)
    expect(protectedResp.headers.get('location')).toBe('/security/login')

    await entry.stop()
  })
})
