/**
 * 构建产物冒烟测试：对 lib/host/index.js 做宿主装配验证。
 *
 * 用最小 stub ctx 实例化 SecurityService（真实五模块 + 临时 plugin-data 目录），
 * 验证：构造不挂起、status 端点可调、accountCreate + login 闭环可走通。
 * 不验证真实 typert Gateway（需独立 profile）——那是关卡 8 的后续步骤。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const { default: SecurityService } = await import(join(ROOT, 'lib/host/index.js'))

// ── 最小 stub ctx（满足 TypertRemoteService 构造的 ctx 表面）──
const stubCtx = {
  root: undefined,
  reflect: { props: {}, provide() {} },
  get: () => undefined,
  inject: (_keys, cb) => { cb(stubCtx) },
  effect: () => {},
  on: () => () => {},
  plugin: () => Promise.resolve(),
  logger: { warn() {}, info() {}, error() {} },
}

const tmpDir = await mkdtemp(join(tmpdir(), 'dsh-web-security-smoke-'))

try {
  // 实例化（真实五模块装配 + 临时目录；enabled=false 避免 3443 端口冲突）
  const svc = new SecurityService(stubCtx, {
    enabled: false,
    entry: { host: '0.0.0.0', port: 3443, tls: { certPath: null, keyPath: null }, tlsMode: 'http' },
    upstream: { host: '127.0.0.1', port: 3080 },
    session: { ttlMinutes: 480 },
    rateLimit: { maxAttempts: 5, windowMinutes: 15 },
    dshHome: tmpDir,
    rpID: '',
  })

  // status 端点可调
  const status = await svc.status({})
  if (status.enabled !== false) throw new Error('status.enabled 应为 false（enabled=false 不启动入口）')
  if (status.entry.port !== 3443) throw new Error('status.entry.port 应为 3443')
  console.log('✅ status 端点可调，entry:', JSON.stringify(status.entry))

  // hasAccounts 应为 null（未认证请求——审计 M1）
  if (status.hasAccounts !== null) throw new Error('status.hasAccounts 应为 null')
  console.log('✅ hasAccounts=null（不泄露初始化状态）')

  // accountCreate → 创建首个管理员（loopback 信任——审计 S1）
  const createResult = await svc.accountCreate({ username: 'admin', password: 'SecurePass123!' })
  if (!createResult.ok) throw new Error(`accountCreate 失败: ${JSON.stringify(createResult.error)}`)
  console.log('✅ accountCreate 成功')

  // login → 正确密码
  const loginResult = await svc.login({ username: 'admin', password: 'SecurePass123!' })
  if (!loginResult.ok) throw new Error(`login 失败: ${JSON.stringify(loginResult)}`)
  if (!loginResult.cookie) throw new Error('login 成功但未返回 cookie')
  console.log('✅ login 正确密码成功 + cookie 已签发')

  // login → 错误密码
  const failResult = await svc.login({ username: 'admin', password: 'WrongPass123!' })
  if (failResult.ok) throw new Error('错误密码不应成功')
  if (failResult.code !== 'bad-credentials') throw new Error(`期望 bad-credentials，得到 ${failResult.code}`)
  console.log('✅ login 错误密码返回 bad-credentials')

  // accountsList
  const accounts = await svc.accountsList({})
  if (accounts.length !== 1) throw new Error(`期望 1 个账号，得到 ${accounts.length}`)
  if (accounts[0].username !== 'admin') throw new Error('账号名不匹配')
  console.log('✅ accountsList 返回 1 个账号')

  // settingsRead
  const settings = await svc.settingsRead({})
  if (settings.passwordLogin !== true) throw new Error('passwordLogin 应为 true')
  console.log('✅ settingsRead 返回默认设置')

  // settingsWrite → 关闭 auditEnabled（审计 M2：触发 settings-changed 事件）
  const writeResult = await svc.settingsWrite({ auditEnabled: false })
  if (!writeResult.ok) throw new Error('settingsWrite 失败')
  if (writeResult.value.auditEnabled !== false) throw new Error('auditEnabled 未更新')
  console.log('✅ settingsWrite 关闭 auditEnabled')

  // auditRead（等待防抖落盘 1s + buffer flush 后磁盘才有数据）
  await new Promise(r => setTimeout(r, 1200))
  const audit = await svc.auditRead({ offset: 0, limit: 10 })
  if (audit.events.length === 0) throw new Error('期望审计事件 > 0')
  console.log(`✅ auditRead 返回 ${audit.events.length} 条事件`)

  // ── M2 入口服务器端到端（简化：验证入口启动 + 未认证 302 + 登录页）──
  const { createEntryServer } = await import(join(ROOT, 'lib/host/index.js'))
  const { createServer: createHttpServer } = await import('node:http')

  // stub 上游（模拟 3080）
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`upstream:${req.url}`)
  })
  await new Promise(r => upstream.listen(0, r))
  const upstreamPort = upstream.address().port

  // 最小 stub deps（补全所有 SecurityDeps 面——运行时 JS 不检查类型但方法调用不能缺失）
  const noop = () => {}
  const entryDeps = {
    listAccounts: async () => [],
    verifyPassword: async () => false,
    createAccount: async () => {},
    updatePassword: async () => {},
    removeAccount: async () => {},
    hasAccounts: async () => false,
    loginGate: async () => ({ state: 'allowed' }),
    recordFailure: noop,
    recordSuccess: noop,
    createSession: () => ({ token: 'x'.repeat(43), cookie: 'dsh_web_security_session=x; Path=/' }),
    resolveSession: () => undefined,
    revokeSession: noop,
    recordEvent: noop,
    readAudit: async () => ({ events: [], hasMore: false }),
    readSettings: () => ({ passwordLogin: true, passkeyLogin: false, sessionTtlMinutes: 480, maxLoginAttempts: 5, rateLimitWindowMinutes: 15, auditEnabled: true }),
    writeSettings: async () => ({ ok: false, error: { code: 'stub', message: 'stub' } }),
    config: { enabled: true, entry: { host: '127.0.0.1', port: 13443, tls: 'http' }, rpID: '' },
    passkeyRegisterBegin: async () => { throw new Error('passkey not available') },
    passkeyRegisterComplete: async () => ({ ok: false, error: { code: 'not-available', message: 'passkey not available' } }),
    passkeyLoginBegin: async () => { throw new Error('passkey not available') },
    passkeyLoginComplete: async () => ({ ok: false, code: 'bad-credentials' }),
  }
  const entry = createEntryServer(entryDeps, {
    host: '127.0.0.1', port: 13555, tlsMode: 'http', certPath: null, keyPath: null,
    upstream: { host: '127.0.0.1', port: upstreamPort },
    maxAttempts: 5, windowMs: 900_000,
  })
  await entry.start()

  // 未认证请求 → 302 登录页
  const unauthResp = await fetch('http://127.0.0.1:13555/api/test', { redirect: 'manual' })
  if (unauthResp.status !== 302) throw new Error(`未认证应 302，得到 ${unauthResp.status}`)
  if (unauthResp.headers.get('location') !== '/security/login') throw new Error('302 location 不对')
  console.log('✅ 未认证请求 302 到登录页（M2）')

  // 登录页 HTML
  const pageResp = await fetch('http://127.0.0.1:13555/security/login')
  const pageHtml = await pageResp.text()
  if (!pageHtml.includes('dsh 安全登录')) throw new Error('登录页 HTML 不含标题')
  console.log('✅ 登录页 HTML 可访问（M2）')

  await entry.stop()
  upstream.close()

  console.log('\n冒烟测试全部通过 ✅（含 M2 入口端到端）')
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}
