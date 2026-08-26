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
const passkeyBtn = document.getElementById('passkeyBtn');

// 启动时查询登录方式开关。
(async () => {
  try {
    const resp = await fetch('/security/api/status');
    const status = await resp.json();
    if (status.methods.passkey === true) { passkeyBtn.disabled = false; }
  } catch (ex) { /* status 不可用 → passkey 保持 disabled */ }
})();

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

// ── passkey 登录（M3）──
passkeyBtn.addEventListener('click', async () => {
  err.textContent = '';
  passkeyBtn.disabled = true;
  try {
    // begin：请求认证选项。
    const usernameField = document.getElementById('username').value;
    const beginResp = await fetch('/security/api/passkey/login/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(usernameField ? { username: usernameField } : {}),
    });
    const beginResult = await beginResp.json();
    if (!beginResult.ok) { err.textContent = beginResult.error || 'passkey 不可用'; return; }

    // 浏览器 WebAuthn 断言（base64url 解码 challenge）。
    const options = beginResult.options;
    options.challenge = base64urlToBuffer(options.challenge);
    if (options.allowCredentials) {
      for (const cred of options.allowCredentials) cred.id = base64urlToBuffer(cred.id);
    }
    const assertion = await navigator.credentials.get({ publicKey: options });
    if (!assertion) { err.textContent = 'passkey 取消'; return; }

    // 序列化断言（ArrayBuffer → base64url）。
    const assertionJSON = serializeAssertion(assertion);

    // complete：验证断言。
    const completeResp = await fetch('/security/api/passkey/login/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion: assertionJSON }),
    });
    const completeResult = await completeResp.json();
    if (completeResult.ok) { window.location.href = '/'; }
    else if (completeResult.code === 'locked') { err.textContent = '登录尝试过多'; }
    else { err.textContent = 'passkey 验证失败'; }
  } catch (ex) {
    err.textContent = ex.name === 'NotAllowedError' ? 'passkey 操作取消或超时' : 'passkey 错误';
  } finally { passkeyBtn.disabled = false; }
});

function base64urlToBuffer(b64url) {
  const pad = '='.repeat((4 - b64url.length % 4) % 4);
  const base64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function serializeAssertion(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: {},
    response: {
      clientDataJSON: bufferToBase64url(r.clientDataJSON),
      authenticatorData: bufferToBase64url(r.authenticatorData),
      signature: bufferToBase64url(r.signature),
      userHandle: r.userHandle ? bufferToBase64url(r.userHandle) : undefined,
    },
  };
}
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
    // 入口是边缘节点（直接面向公网）——不信任任何 forwarded 头（审计 V21）。
    // 攻击者可伪造 X-Forwarded-For 绕过 IP 维度限速。
    return req.socket.remoteAddress ?? 'unknown'
  }

  /** pathname 规范化（去 query string——审计 V23/X1：所有 path 判断统一走此函数）。 */
  function pathnameOf(req: IncomingMessage): string {
    try {
      return new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      return '/'
    }
  }

  /** 认证门：未认证 → 302 登录页。 */
  function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
    // X1：使用规范化 pathname，与 handleRequest 一致。
    const result = authGate.check(req.headers.cookie, pathnameOf(req))
    if (!result.authenticated) {
      res.writeHead(302, { location: '/security/login' })
      res.end()
      return false
    }
    return true
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 用 pathname 规范化（去 query string，防 /login?foo=bar 绕过精确匹配——审计 V23）。
    const path = new URL(req.url ?? '/', 'http://x').pathname

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
        methods: { password: settings.passwordLogin, passkey: deps.config.rpID.length > 0 && settings.passkeyLogin },
      }))
      return
    }

    // ── passkey API（M3）──

    if (path === '/security/api/passkey/login/begin' && req.method === 'POST') {
      await handlePasskeyLoginBegin(req, res)
      return
    }

    if (path === '/security/api/passkey/login/complete' && req.method === 'POST') {
      await handlePasskeyLoginComplete(req, res)
      return
    }

    // passkey 注册需要已认证（authenticated）。
    if (path === '/security/api/passkey/register/begin' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      await handlePasskeyRegisterBegin(req, res)
      return
    }

    if (path === '/security/api/passkey/register/complete' && req.method === 'POST') {
      if (!requireAuth(req, res)) return
      await handlePasskeyRegisterComplete(req, res)
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
    // 解析 JSON body（限制 64KB 防内存耗尽 DoS——审计 V22）。
    const MAX_LOGIN_BODY = 65_536
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
      if (Buffer.byteLength(body, 'utf8') > MAX_LOGIN_BODY) {
        res.writeHead(413, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'body too large' }))
        return
      }
    }
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
    // 长度限制（审计 X5）：超长 username 会进 rate-limiter Map key + 审计日志
    // （10000 条 × 100KB = 1GB 内存风险）；超长密码无意义。
    if (parsed.username.length > 64 || parsed.username.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'bad-credentials' }))
      return
    }
    if (parsed.password.length > 1024) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'bad-credentials' }))
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
    // 清除 cookie（Secure 标志与签发时一致——审计 X6）。
    const securePart = config.tlsMode === 'https' ? ' Secure;' : ''
    res.writeHead(302, {
      'set-cookie': `${SESSION_COOKIE_NAME}=; HttpOnly;${securePart} SameSite=Strict; Path=/; Max-Age=0`,
      'location': '/security/login',
    })
    res.end()
  }

  // ── passkey API handlers（M3）──

  /** 读取 JSON body（限制 256KB——WebAuthn 响应含证书链可能较大）。 */
  async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
    const MAX_BODY = 262_144
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'body too large' }))
        return undefined
      }
    }
    try {
      return JSON.parse(body)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
      return undefined
    }
  }

  /** passkey 注册开始：返回 PublicKeyCredentialCreationOptionsJSON。 */
  async function handlePasskeyRegisterBegin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req, res)
    if (body === undefined) return
    const username = (body as { username?: unknown }).username
    if (typeof username !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'missing username' }))
      return
    }
    try {
      const options = await deps.passkeyRegisterBegin(username)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, options }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** passkey 注册完成：验证注册响应并存储凭证。 */
  async function handlePasskeyRegisterComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req, res)
    if (body === undefined) return
    const { username, credential } = body as { username?: unknown; credential?: unknown }
    if (typeof username !== 'string' || typeof credential !== 'object' || credential === null) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'missing username or credential' }))
      return
    }
    const result = await deps.passkeyRegisterComplete(username, credential)
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result))
  }

  /** passkey 登录开始：返回 PublicKeyCredentialRequestOptionsJSON。 */
  async function handlePasskeyLoginBegin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req, res)
    if (body === undefined) return
    const username = (body as { username?: unknown }).username
    try {
      const options = await deps.passkeyLoginBegin(typeof username === 'string' ? username : undefined)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, options }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** passkey 登录完成：验证断言 → 创建会话 → Set-Cookie。 */
  async function handlePasskeyLoginComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = getClientIp(req)
    // IP 维度限速（与密码登录同门）。
    const gate = ipLimiter.gate(ip)
    if (gate.state === 'locked') {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'locked', retryAfterMs: gate.retryAfterMs }))
      return
    }
    const body = await readJsonBody(req, res)
    if (body === undefined) return
    const assertion = (body as { assertion?: unknown }).assertion
    if (typeof assertion !== 'object' || assertion === null) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'missing assertion' }))
      return
    }
    const result = await deps.passkeyLoginComplete(assertion, ip)
    if (result.ok) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': result.cookie,
      })
      res.end(JSON.stringify({ ok: true }))
    } else {
      if (result.code === 'bad-credentials') ipLimiter.recordFailure(ip)
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    }
  }

  /** upgrade 事件：认证门 → 代理转发。 */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // X1：使用规范化 pathname（与 handleRequest 一致——防 /security/..%2f 绕过）。
    const path = pathnameOf(req)
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
