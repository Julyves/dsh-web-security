/**
 * 安全入口服务器：TLS/HTTP 监听 + 认证门 + 路由分发 + 反向代理。
 *
 * 职责（蓝图 D2/D4）：
 * - 监听入口端口（默认 0.0.0.0:3443）；
 * - /security/login（GET）→ 返回登录页 HTML；
 * - /security/api/login（POST JSON）→ 调 typert login 端点；
 * - /security/api/logout（GET/POST）→ cookie 解析 + revokeSession + 清 cookie；
 * - /security/api/status（GET）→ 返回 SecurityStatus；
 * - 其余路径 → 认证门：有 cookie 且会话有效 → 代理转发；否则 → 302 登录页；
 * - WebSocket upgrade → 认证门 → 代理转发。
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import { createProxy, type ProxyUpstream } from './proxy'
import { createAuthGate } from './auth-gate'
import { createIpRateLimiter } from './ip-rate-limiter'
import { parseSessionToken, SESSION_COOKIE_NAME } from './session-store'
import type { SecurityDeps } from '../contracts/host-endpoints'

/** 登录页 HTML（内联；M3 可替换为独立 bundle）。 */
const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh 安全登录</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--dsw-alias-bg, #1a1a2e); color: var(--dsw-alias-fg, #e0e0e0); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: var(--dsw-alias-surface, #16213e); border-radius: 12px; padding: 2rem; width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
  h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; }
  input { width: 100%; padding: 0.625rem; margin-bottom: 0.75rem; border: 1px solid var(--dsw-alias-border, #333); border-radius: 6px; background: var(--dsw-alias-input-bg, #0f0f1e); color: inherit; font-size: 0.875rem; }
  button { width: 100%; padding: 0.625rem; border: none; border-radius: 6px; background: var(--dsw-alias-accent, #53348c); color: #fff; font-size: 0.875rem; cursor: pointer; }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: #ff6b6b; font-size: 0.75rem; margin-bottom: 0.5rem; min-height: 1rem; }
  .passkey-btn { margin-top: 0.5rem; background: var(--dsw-alias-surface2, #2a2a4e); }
</style>
</head>
<body>
<div class="card">
<h1>dsh 安全入口</h1>
<form id="loginForm">
  <input type="text" id="username" placeholder="用户名" autocomplete="username" required>
  <input type="password" id="password" placeholder="密码" autocomplete="current-password" required>
  <div class="error" id="error"></div>
  <button type="submit" id="loginBtn">登录</button>
  <button type="button" class="passkey-btn" id="passkeyBtn" disabled>使用通行密钥登录</button>
</form>
</div>
<script>
const form = document.getElementById('loginForm');
const err = document.getElementById('error');
const btn = document.getElementById('loginBtn');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  btn.disabled = true;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const resp = await fetch('/security/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const result = await resp.json();
    if (result.ok) { window.location.href = '/'; }
    else if (result.code === 'locked') { err.textContent = '登录尝试过多，请 ' + Math.ceil(result.retryAfterMs / 60000) + ' 分钟后重试'; }
    else { err.textContent = '用户名或密码错误'; }
  } catch (ex) { err.textContent = '网络错误'; }
  finally { btn.disabled = false; }
});
</script>
</body>
</html>`

/** 入口服务器配置。 */
export interface EntryServerConfig {
  readonly host: '0.0.0.0' | '127.0.0.1'
  readonly port: number
  readonly tlsMode: 'https' | 'http'
  readonly certPath: string | null
  readonly keyPath: string | null
  readonly upstream: ProxyUpstream
  readonly maxAttempts: number
  readonly windowMs: number
}

/**
 * 创建入口服务器。
 * @param deps - SecurityDeps（会话面 + 审计面 + 设置面）。
 * @param config - 入口配置。
 */
export function createEntryServer(deps: SecurityDeps, config: EntryServerConfig): {
  start: () => Promise<void>
  stop: () => Promise<void>
} {
  const proxy = createProxy(config.upstream)
  const authGate = createAuthGate({ resolveSession: deps.resolveSession })
  const ipLimiter = createIpRateLimiter(config.maxAttempts, config.windowMs)
  let server: Server | HttpsServer | undefined

  function getClientIp(req: IncomingMessage): string {
    // X-Forwarded-For 信任链：入口是边缘节点，直接取 socket 远端。
    // 如果自己在代理后（不推荐——入口应直接面向公网），XFF 可被伪造。
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') return xff.split(',')[0]!.trim()
    return req.socket.remoteAddress ?? 'unknown'
  }

  /** 认证门：未认证 → 302 登录页。 */
  function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
    const result = authGate.check(req.headers.cookie, req.url ?? '/')
    if (!result.authenticated) {
      res.writeHead(302, { location: '/security/login' })
      res.end()
      return false
    }
    return true
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? '/'

    // ── /security/* 公开路由 ──
    if (path === '/security/login' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(LOGIN_PAGE_HTML)
      return
    }

    if (path === '/security/api/login' && req.method === 'POST') {
      await handleLogin(req, res)
      return
    }

    if (path === '/security/api/logout' && (req.method === 'GET' || req.method === 'POST')) {
      await handleLogout(req, res)
      return
    }

    if (path === '/security/api/status' && req.method === 'GET') {
      const settings = deps.readSettings()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        enabled: deps.config.enabled,
        methods: { password: settings.passwordLogin, passkey: deps.config.rpID.length > 0 },
      }))
      return
    }

    // 其余 /security/* → 404。
    if (path.startsWith('/security/')) {
      res.writeHead(404)
      res.end()
      return
    }

    // ── 受保护路径：认证门 ──
    if (!requireAuth(req, res)) return

    // 已认证 → 代理转发。
    await proxy.forward(req, res, getClientIp(req))
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = getClientIp(req)
    // IP 维度限速。
    const gate = ipLimiter.gate(ip)
    if (gate.state === 'locked') {
      deps.recordEvent({ kind: 'login-locked', at: Date.now(), actor: ip, detail: `ip retryAfterMs=${gate.retryAfterMs}` })
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'locked', retryAfterMs: gate.retryAfterMs }))
      return
    }
    // 解析 JSON body。
    let body = ''
    for await (const chunk of req) body += chunk.toString()
    let parsed: { username?: string; password?: string }
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
      return
    }
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'missing username or password' }))
      return
    }
    // 调用 SecurityDeps 的 login 面（组合 verifyPassword + rateLimiter + createSession）。
    const gate2 = await deps.loginGate(parsed.username)
    if (gate2.state === 'locked') {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'locked', retryAfterMs: gate2.retryAfterMs }))
      return
    }
    const valid = await deps.verifyPassword(parsed.username, parsed.password)
    if (!valid) {
      await deps.recordFailure(parsed.username)
      ipLimiter.recordFailure(ip)
      deps.recordEvent({ kind: 'login-failure', at: Date.now(), actor: parsed.username, ip })
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'bad-credentials' }))
      return
    }
    await deps.recordSuccess(parsed.username)
    ipLimiter.recordSuccess(ip)
    deps.recordEvent({ kind: 'login-success', at: Date.now(), actor: parsed.username, ip })
    // 创建会话 + Set-Cookie。
    const { cookie } = deps.createSession(parsed.username, ip)
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': cookie,
    })
    res.end(JSON.stringify({ ok: true }))
  }

  async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = parseSessionToken(req.headers.cookie)
    if (token !== undefined) {
      deps.revokeSession(token)
      deps.recordEvent({ kind: 'logout', at: Date.now(), actor: 'unknown' })
    }
    // 清除 cookie。
    res.writeHead(302, {
      'set-cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      'location': '/security/login',
    })
    res.end()
  }

  /** upgrade 事件：认证门 → 代理转发。 */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = req.url ?? '/'
    // /security/* 不需要 upgrade（没有 WebSocket）。
    if (path.startsWith('/security/')) {
      socket.destroy()
      return
    }
    // 认证门。
    const result = authGate.check(req.headers.cookie, path)
    if (!result.authenticated) {
      socket.end([
        'HTTP/1.1 401 Unauthorized',
        'Connection: close',
        'Content-Type: text/plain',
        '',
        'Authentication required',
      ].join('\r\n'))
      return
    }
    // 已认证 → 代理转发 upgrade。
    void proxy.forwardUpgrade(req, socket, head, getClientIp(req)).catch(() => {
      if (!socket.destroyed) socket.destroy()
    })
  }

  async function start(): Promise<void> {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end()
        }
      })
    }
    if (config.tlsMode === 'https' && config.certPath !== null && config.keyPath !== null) {
      const cert = readFileSync(config.certPath)
      const key = readFileSync(config.keyPath)
      server = createHttpsServer({ cert, key }, handler)
    } else {
      server = createServer(handler)
    }
    server.on('upgrade', handleUpgrade)
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(config.port, config.host, () => {
        server!.off('error', reject)
        resolve()
      })
    })
  }

  async function stop(): Promise<void> {
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      server!.closeAllConnections?.()
      server!.close(() => resolve())
    })
    server = undefined
  }

  return { start, stop }
}
